"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { env } from "../env";
import { getStore, memoryStore } from "../data";
import { deliverySentence, sendInviteEmail } from "../invite-mailer";
import { getAuthContext, requireAdmin } from "../session";
import { createSupabaseServerClient } from "../supabase/server";
import { inviteSchema, orgSchema, planSchema } from "../validation";
import { PLANS, type PlanTier } from "../types";

export type ActionResult = {
  error?: string;
  ok?: boolean;
  message?: string;
  token?: string;
  /** true only when the invite email was accepted by the provider. */
  delivered?: boolean;
};

/* -------------------------------------------------------------------------- */
/* Onboarding — create the first organization for a fresh account             */
/* -------------------------------------------------------------------------- */
export async function createOrganizationAction(formData: FormData): Promise<ActionResult> {
  const parsed = orgSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter a team name" };

  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  if (env.demoMode) {
    /*
     * Demo mode has no create_organization RPC, so this shows what the live
     * flow does: the account becomes the owner of the studio it just named.
     * In the seed that is Cinegem Studio — the same studio the join link
     * belongs to — which is precisely how the client ended up as the owner of
     * an empty workspace after asking to join one. `requestToJoinAction` and
     * this page now stop that from happening in the first place, and this
     * branch is only reached by someone with neither a studio nor a request.
     */
    const store = memoryStore;
    const org = await store.getOrg((await import("../data/types")).DEMO_ORG_ID);
    if (org) {
      await store.updateOrg(org.id, { name: parsed.data.name });
      const membership = await store.getMembership(org.id, ctx.user.id);
      if (!membership) {
        await store.addMembership(org.id, ctx.user.id, "owner", 40);
      } else if (membership.role !== "owner") {
        await store.updateMemberRole(org.id, membership.id, "owner");
      }
    }
    revalidatePath("/", "layout");
    redirect("/app");
  }

  if (ctx.membership) redirect("/app");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_organization", { org_name: parsed.data.name });
  if (error) return { error: error.message };

  /*
   * No cookie: the studio a session opens is decided by membership order (see
   * lib/session.ts). A brand-new account has exactly one membership, so it
   * opens the studio it just made.
   */
  revalidatePath("/", "layout");
  redirect("/app");
}

export async function renameOrgAction(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  if (session.membership.role === "member") return { error: "Not allowed" };
  const parsed = orgSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name" };

  try {
    await getStore().updateOrg(session.organization.id, { name: parsed.data.name });
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app/settings");
  revalidatePath("/app", "layout");
  return { ok: true, message: "Team name updated." };
}

/* -------------------------------------------------------------------------- */
/* Plan / seats (Stripe plugs in here later)                                  */
/* -------------------------------------------------------------------------- */
export async function setPlanAction(plan: string): Promise<ActionResult> {
  const session = await requireAdmin();
  if (session.membership.role !== "owner") return { error: "Only the owner can change the plan." };
  const parsed = planSchema.safeParse(plan);
  if (!parsed.success) return { error: "Unknown plan" };

  const target = parsed.data as PlanTier;

  if (!env.demoMode) {
    // No payment provider wired yet — record the intent instead of silently
    // granting a paid plan.
    console.info(`[workpulse] upgrade requested org=${session.organization.id} plan=${target}`);
    return {
      message: `Upgrade request for the ${PLANS[target].label} plan received. Billing isn't enabled in this build — connect Stripe to make upgrades self-serve.`,
    };
  }

  try {
    await getStore().updateOrg(session.organization.id, { plan: target, seatLimit: PLANS[target].seats });
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app/settings");
  revalidatePath("/app", "layout");
  return { ok: true, message: `Plan switched to ${PLANS[target].label} (${PLANS[target].seats} seats).` };
}

/* -------------------------------------------------------------------------- */
/* Invites                                                                    */
/* -------------------------------------------------------------------------- */
export async function createInviteAction(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = inviteSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? "member"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the invite details" };

  try {
    const invite = await getStore().createInvite(
      session.organization.id,
      parsed.data.email ?? "",
      parsed.data.role,
    );
    /*
     * Send the email ourselves and report what actually happened.
     *
     * The old message said "emailed (if delivery is configured)", which is not
     * a status — the client sent an invite to their own Gmail, read "Invite
     * ready", and received nothing. Now the sentence comes from the transport:
     * "Emailed … via Resend", or "Resend rejected it: <its own words>", or
     * "not emailed because no provider is configured". The link is always
     * shown either way.
     */
    const outcome = parsed.data.email
      ? await sendInviteEmail({
          to: parsed.data.email,
          orgName: session.organization.name,
          inviterName: session.user.fullName ?? session.user.email,
          role: parsed.data.role,
          link: `/invite/${invite.token}`,
          expiresAt: invite.expiresAt,
        })
      : null;

    revalidatePath("/app/settings");
    return {
      ok: true,
      token: invite.token,
      delivered: outcome?.status === "sent",
      message: parsed.data.email
        ? `Invite created. ${outcome ? deliverySentence(outcome) : "The link below works."}`
        : "Shareable link created — anyone with the link can join.",
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function revokeInviteAction(inviteId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  try {
    await getStore().revokeInvite(session.organization.id, inviteId);
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app/settings");
  return { ok: true };
}

export async function acceptInviteAction(token: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) redirect(`/login?next=/invite/${encodeURIComponent(token)}`);

  if (env.demoMode) {
    await memoryStore.acceptDemoInvite(token).catch(() => null);
    revalidatePath("/", "layout");
    redirect("/app");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("accept_invite", { invite_token: token });
  if (error) return { error: error.message };

  /*
   * Accepting an invite is the newest membership this account has, so the
   * session resolver opens the inviting studio without needing a cookie —
   * which is exactly what "a join link only ever shows the joined studio"
   * means in practice.
   */
  revalidatePath("/", "layout");
  redirect("/app");
}

/* -------------------------------------------------------------------------- */
/* Ownership transfer                                                         */
/* -------------------------------------------------------------------------- */
export async function transferOwnershipAction(userId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  if (session.membership.role !== "owner") return { error: "Only the owner can transfer ownership." };
  if (userId === session.user.id) return { error: "You are already the owner." };
  if (env.demoMode) {
    return { error: "Ownership transfer runs through a DB function — available once Supabase is connected." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("transfer_ownership", {
    target_org: session.organization.id,
    new_owner: userId,
  });
  if (error) return { error: error.message };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Ownership transferred." };
}
