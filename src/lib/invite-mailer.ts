import "server-only";

/**
 * Invite email delivery — the missing half of "Invite ready".
 *
 * What was wrong
 * --------------
 * The panel said "Invite created and emailed (if delivery is configured)". It
 * was not. `0003` can *queue* an email through Supabase's own mailer, but that
 * mailer only delivers to addresses on the project's team and is capped at a
 * couple of messages an hour on a free project. So a personal invite to a
 * normal Gmail address silently went nowhere, and the copy blamed "delivery".
 *
 * What this does now
 * ------------------
 * Sends the invitation ourselves, with a transactional provider, in this order
 * of preference:
 *
 *   1. Resend        RESEND_API_KEY                (+ INVITE_FROM_EMAIL)
 *   2. Brevo         BREVO_API_KEY                 (+ INVITE_FROM_EMAIL)
 *   3. Supabase      SUPABASE_SERVICE_ROLE_KEY     (works, but only to team
 *                                                   addresses — says so)
 *
 * If none are set, the invite still exists and the panel hands over the link
 * with a plain explanation instead of a promise. `describeDelivery()` is what
 * the settings page renders, so an admin can always see which transport is in
 * use *before* sending, not after something silently fails.
 *
 * Nothing here throws into the action: an email that cannot be sent must never
 * cost the admin the invite row they just created.
 */

import { env } from "./env";

/** The invite as the template needs it. */
export interface InviteEmail {
  to: string;
  orgName: string;
  inviterName: string;
  role: string;
  link: string;
  expiresAt?: string | null;
}

export type DeliveryOutcome =
  | { status: "sent"; via: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; via: string; reason: string };

export type DeliveryMode = "resend" | "brevo" | "supabase" | "none";

/** Which transport would be used right now — shown in the invite panel. */
export function deliveryMode(): DeliveryMode {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return "supabase";
  return "none";
}

/**
 * Human-readable status for the settings panel.
 *
 * The `warning` case is the important one: a service-role key alone *looks*
 * configured but cannot deliver to an arbitrary address, so the panel says so
 * rather than repeating the old "if delivery is configured".
 */
export function describeDelivery(): {
  mode: DeliveryMode;
  label: string;
  ready: boolean;
  detail: string;
} {
  switch (deliveryMode()) {
    case "resend":
      return {
        mode: "resend",
        label: "Resend",
        ready: true,
        detail: "Invitations are emailed from your Resend account.",
      };
    case "brevo":
      return {
        mode: "brevo",
        label: "Brevo",
        ready: true,
        detail: "Invitations are emailed from your Brevo account.",
      };
    case "supabase":
      return {
        mode: "supabase",
        label: "Supabase + your SMTP",
        ready: true,
        detail:
          "Invitations are sent through your Supabase project's mailer. That reaches any address once custom SMTP is configured (docs/EMAIL.md); until then Supabase only accepts your team's own addresses, and the result below quotes its exact refusal.",
      };
    default:
      return {
        mode: "none",
        label: "Copy link only",
        ready: false,
        detail:
          "No email provider is configured, so invitations are not emailed. Copy the link and send it yourself, or set RESEND_API_KEY.",
      };
  }
}

const FROM = () => process.env.INVITE_FROM_EMAIL || "WorkPulse <onboarding@resend.dev>";

function absoluteUrl(link: string): string {
  if (/^https?:\/\//i.test(link)) return link;
  return `${env.siteUrl.replace(/\/$/, "")}${link.startsWith("/") ? "" : "/"}${link}`;
}

function bodyText(invite: InviteEmail, link: string): string {
  return [
    `${invite.inviterName} invited you to ${invite.orgName} on WorkPulse.`,
    "",
    `You'll join as a ${invite.role}.`,
    invite.expiresAt ? `This link expires on ${new Date(invite.expiresAt).toDateString()}.` : "",
    "",
    `Accept the invitation: ${link}`,
    "",
    "If you weren't expecting this, you can ignore the email — nothing happens until you open the link.",
  ]
    .filter(Boolean)
    .join("\n");
}

function bodyHtml(invite: InviteEmail, link: string): string {
  /* Deliberately plain: one button, one fallback URL, no images. Inline styles
     only, because email clients strip everything else. */
  return `<!doctype html>
<html><body style="margin:0;background:#faf9f6;padding:28px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2a2724">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e6e1d9;border-radius:12px">
    <tr><td style="padding:26px 26px 8px">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a8a29a">WorkPulse</div>
      <h1 style="margin:10px 0 0;font-size:20px;line-height:1.3;font-weight:600">Join ${escapeHtml(invite.orgName)}</h1>
      <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#57534e">
        ${escapeHtml(invite.inviterName)} invited you to join <b>${escapeHtml(invite.orgName)}</b> as a ${escapeHtml(invite.role)}.
      </p>
    </td></tr>
    <tr><td style="padding:18px 26px 6px">
      <a href="${link}" style="display:inline-block;background:#b4552d;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:8px">Accept invitation</a>
    </td></tr>
    <tr><td style="padding:14px 26px 26px">
      <p style="margin:0;font-size:12px;line-height:1.6;color:#8a847c">
        Or paste this into your browser:<br>
        <span style="word-break:break-all;color:#96431f">${link}</span>
      </p>
      ${invite.expiresAt ? `<p style="margin:12px 0 0;font-size:12px;color:#8a847c">This link expires on ${new Date(invite.expiresAt).toDateString()}.</p>` : ""}
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function viaResend(invite: InviteEmail, link: string): Promise<DeliveryOutcome> {
  const key = process.env.RESEND_API_KEY!;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM(),
        to: [invite.to],
        subject: `${invite.inviterName} invited you to ${invite.orgName}`,
        text: bodyText(invite, link),
        html: bodyHtml(invite, link),
      }),
    });
    if (response.ok) return { status: "sent", via: "Resend" };
    /* Resend's own wording is the useful part ("domain is not verified"), so it
       is passed through rather than replaced by a generic message. */
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    return {
      status: "failed",
      via: "Resend",
      reason: payload?.message ?? `Resend answered ${response.status}.`,
    };
  } catch (error) {
    return { status: "failed", via: "Resend", reason: (error as Error).message };
  }
}

async function viaBrevo(invite: InviteEmail, link: string): Promise<DeliveryOutcome> {
  const key = process.env.BREVO_API_KEY!;
  const from = FROM();
  const match = /^(.*)<(.+)>$/.exec(from);
  const senderName = (match?.[1] ?? "WorkPulse").trim().replace(/^"|"$/g, "");
  const senderEmail = (match?.[2] ?? from).trim();
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: invite.to }],
        subject: `${invite.inviterName} invited you to ${invite.orgName}`,
        textContent: bodyText(invite, link),
        htmlContent: bodyHtml(invite, link),
      }),
    });
    if (response.ok) return { status: "sent", via: "Brevo" };
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    return {
      status: "failed",
      via: "Brevo",
      reason: payload?.message ?? `Brevo answered ${response.status}.`,
    };
  } catch (error) {
    return { status: "failed", via: "Brevo", reason: (error as Error).message };
  }
}

/**
 * Supabase's admin invite endpoint. Kept as a last resort because it is the only
 * transport that needs no extra account — but it cannot email an arbitrary
 * address, so a rejection here is reported honestly instead of swallowed.
 */
async function viaSupabase(invite: InviteEmail, link: string): Promise<DeliveryOutcome> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!env.supabaseUrl) {
    return { status: "skipped", reason: "NEXT_PUBLIC_SUPABASE_URL is not set." };
  }
  /*
   * `redirect_to` is what makes a Supabase-mailed invite actually join the
   * studio. Supabase sends its own confirmation link; without this it lands the
   * person on /app with no invite token, and they end up on "name your
   * workspace" instead of the studio that invited them. Sending them back to
   * /auth/callback?next=/invite/<token> means the callback signs them in and
   * then the invite page accepts it.
   */
  const next = new URL(link).pathname;
  try {
    const response = await fetch(`${env.supabaseUrl.replace(/\/$/, "")}/auth/v1/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        email: invite.to,
        data: { invited_to: invite.orgName, invite_link: link },
        redirect_to: `${env.siteUrl.replace(/\/$/, "")}/auth/callback?next=${encodeURIComponent(next)}`,
      }),
    });
    if (response.ok) return { status: "sent", via: "Supabase mailer" };
    const payload = (await response.json().catch(() => null)) as
      | { msg?: string; message?: string; error_description?: string }
      | null;
    return {
      status: "failed",
      via: "Supabase mailer",
      reason:
        payload?.msg ??
        payload?.message ??
        payload?.error_description ??
        `Supabase answered ${response.status}.`,
    };
  } catch (error) {
    return { status: "failed", via: "Supabase mailer", reason: (error as Error).message };
  }
}

/**
 * Send one invitation. Never throws.
 *
 * `link` may be relative (`/invite/<token>`); it is made absolute here so the
 * email's button works from any mail client.
 */
export async function sendInviteEmail(invite: InviteEmail): Promise<DeliveryOutcome> {
  if (!invite.to) return { status: "skipped", reason: "This is a shareable link, not an email invite." };
  const link = absoluteUrl(invite.link);
  switch (deliveryMode()) {
    case "resend":
      return viaResend(invite, link);
    case "brevo":
      return viaBrevo(invite, link);
    case "supabase":
      return viaSupabase(invite, link);
    default:
      return {
        status: "skipped",
        reason: "No email provider configured (set RESEND_API_KEY).",
      };
  }
}

/** One line for the panel's result message. */
export function deliverySentence(outcome: DeliveryOutcome): string {
  switch (outcome.status) {
    case "sent":
      return `Emailed to the address you entered, via ${outcome.via}.`;
    case "skipped":
      return `Not emailed — ${outcome.reason} The link below still works.`;
    case "failed":
      return `${outcome.via} rejected it: ${outcome.reason} The link below still works.`;
  }
}
