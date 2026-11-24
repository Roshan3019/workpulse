"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { Alert } from "@/components/ui/Modal";
import {
  createInviteAction,
  renameOrgAction,
  revokeInviteAction,
  setPlanAction,
  transferOwnershipAction,
  type ActionResult,
} from "@/lib/actions/org";
import {
  setJoinLinkEnabledAction,
  rotateJoinLinkAction,
} from "@/lib/actions/joining";
import { displayName } from "@/lib/format";
import {
  PLANS,
  type Invite,
  type JoinLink,
  type Member,
  type OrgRole,
  type Organization,
} from "@/lib/types";

const initial: ActionResult = {};

/* -------------------------------------------------------------------------- */
/* Team name                                                                  */
/* -------------------------------------------------------------------------- */
export function OrgNameForm({ org, canEdit }: { org: Organization; canEdit: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (_prev: ActionResult, formData: FormData) => {
    const result = await renameOrgAction(formData);
    if (result.ok) router.refresh();
    return result;
  }, initial);

  return (
    <form action={action} className="space-y-3">
      <div className="field">
        <label htmlFor="name">Team name</label>
        <input id="name" name="name" defaultValue={org.name} disabled={!canEdit} maxLength={80} required />
      </div>
      <div className="field">
        <label htmlFor="slug">Workspace URL</label>
        <input id="slug" defaultValue={`${org.slug}.workpulse.app`} disabled readOnly />
      </div>
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
      {canEdit ? (
        <button type="submit" disabled={pending} className="btn-primary btn-sm">
          {pending ? "Saving…" : "Save changes"}
        </button>
      ) : (
        <p className="text-[12px] text-faint">Only admins can rename the workspace.</p>
      )}
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Invites                                                                    */
/* -------------------------------------------------------------------------- */
export function InvitePanel({
  invites,
  seatsUsed,
  seatLimit,
  canInvite,
  delivery,
}: {
  invites: Invite[];
  seatsUsed: number;
  seatLimit: number;
  canInvite: boolean;
  /**
   * Which transport invitations will use, decided on the server from env.
   * Passed in rather than read in the browser because none of these variables
   * are NEXT_PUBLIC — and because the panel must be able to say "not emailed"
   * *before* an admin types an address and waits for nothing.
   */
  delivery: { mode: "resend" | "brevo" | "supabase" | "none"; label: string; ready: boolean; detail: string };
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (_prev: ActionResult, formData: FormData) => {
    const result = await createInviteAction(formData);
    if (result.ok) router.refresh();
    return result;
  }, initial);
  const [copied, setCopied] = useState<string | null>(null);
  const [revoking, startRevoke] = useTransition();

  const origin = useMemo(() => (typeof window === "undefined" ? "" : window.location.origin), []);
  const full = seatsUsed >= seatLimit;

  async function copy(token: string) {
    const link = `${origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this invite link", link);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-muted">
        <Badge tone={full ? "red" : "green"}>
          {seatsUsed}/{seatLimit} seats used
        </Badge>
        {full ? <span>Seat limit reached. Upgrade the plan to invite more people.</span> : null}
      </div>

      {/*
        The state of email delivery, stated plainly. The previous copy said
        "emailed (if delivery is configured)", which told an admin nothing after
        they had waited for an email that was never going to arrive.
      */}
      <div
        className={`flex flex-wrap items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
          delivery.ready
            ? "border-[#bfe9d6] bg-ok-soft text-[#2f6b4a]"
            : "border-brand-line bg-brand-soft text-brand-dark"
        }`}
      >
        <b className="font-semibold">
          {delivery.ready ? `Email delivery on · ${delivery.label}` : "Invitations are not emailed yet"}
        </b>
        <span className="font-normal">{delivery.detail}</span>
      </div>

      {canInvite ? (
        <form action={action} className="grid gap-2.5 sm:grid-cols-[1fr_150px_auto]">
          <label className="block">
            <span className="sr-only">Teammate email</span>
            <input
              name="email"
              type="email"
              placeholder="teammate@studio.com, or leave blank for a link"
              className="h-10 w-full rounded-xl border border-[#dcd6cc] px-3.5 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="sr-only">Role</span>
            <select
              name="role"
              defaultValue="member"
              className="h-10 w-full rounded-xl border border-line-2 bg-white px-3.5 text-sm font-semibold outline-none focus:border-brand"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" disabled={pending || full} className="btn-primary w-full sm:w-auto">
            {pending ? "Creating…" : "Create invite"}
          </button>
        </form>
      ) : (
        <Alert tone="info">Only owners and admins can invite teammates.</Alert>
      )}

      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.token ? (
        <div
          className={`rounded-xl border px-3.5 py-3 text-[13px] ${
            state.delivered
              ? "border-[#bfe9d6] bg-ok-soft text-[#2f6b4a]"
              : "border-brand-line bg-brand-soft text-brand-dark"
          }`}
        >
          <b>{state.delivered ? "Invite emailed." : "Invite created."}</b>{" "}
          <span className="font-normal">{state.message}</span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white px-2 py-1 text-[12px] break-all">{`${origin}/invite/${state.token}`}</code>
            <button type="button" onClick={() => copy(state.token!)} className="rounded-lg bg-white px-2.5 py-1 text-[12px] font-bold text-ok-dark">
              {copied === state.token ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      {invites.length ? (
        <div className="divide-y divide-[#efece6] rounded-xl border border-line">
          {invites.map((invite) => (
            <div key={invite.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-[13px]">
              <span className="font-semibold">{invite.email ?? "Shareable link"}</span>
              <Badge tone={invite.role === "admin" ? "amber" : "grey"}>{invite.role}</Badge>
              <span className="text-[12px] text-faint">
                expires {new Date(invite.expiresAt).toLocaleDateString()}
              </span>
              <span className="flex w-full items-center gap-2 border-t border-line/70 pt-2 sm:ml-auto sm:w-auto sm:border-0 sm:pt-0">
                <button type="button" onClick={() => copy(invite.token)} className="text-[12.5px] font-bold text-brand">
                  {copied === invite.token ? "Copied ✓" : "Copy link"}
                </button>
                <button
                  type="button"
                  disabled={revoking}
                  onClick={() =>
                    startRevoke(async () => {
                      await revokeInviteAction(invite.id);
                      router.refresh();
                    })
                  }
                  className="text-[12.5px] font-bold text-muted hover:text-[#b91c1c]"
                >
                  Revoke
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12.5px] text-faint">No pending invites.</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Plan                                                                       */
/* -------------------------------------------------------------------------- */
export function PlanPanel({
  org,
  seatsUsed,
  isOwner,
}: {
  org: Organization;
  seatsUsed: number;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function choose(plan: string) {
    startTransition(async () => {
      const result = await setPlanAction(plan);
      if (result.error) setMessage({ tone: "error", text: result.error });
      else if (result.message) setMessage({ tone: "success", text: result.message });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Badge tone="indigo">Current: {PLANS[org.plan].label}</Badge>
        <span className="text-muted">
          {seatsUsed} of {org.seatLimit} seats used
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {Object.entries(PLANS).map(([key, plan]) => {
          const current = org.plan === key;
          return (
            <div
              key={key}
              className={`rounded-2xl border p-4 ${current ? "border-brand bg-brand-soft/40 ring-2 ring-brand" : "border-line bg-white"}`}
            >
              <div className="flex items-center justify-between">
                <b className="text-[15px]">{plan.label}</b>
                {current ? <Badge tone="indigo">Current</Badge> : null}
              </div>
              <div className="mt-1.5 text-[22px] font-semibold tracking-[-0.025em] tabular-nums">
                {plan.priceMonthly === 0 ? "Free" : `$${plan.priceMonthly}`}
                {plan.priceMonthly ? <span className="text-[13px] font-semibold text-muted">/mo</span> : null}
              </div>
              <div className="text-[12px] font-bold text-brand">{plan.seats} seats</div>
              <ul className="mt-2 space-y-1 text-[12.5px] text-ink-2">
                {plan.features.slice(0, 3).map((f) => (
                  <li key={f} className="flex gap-1.5">
                    <span className="text-ok">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={pending || current || !isOwner}
                onClick={() => choose(key)}
                className={`mt-3 w-full ${current ? "btn-outline" : "btn-primary"} btn-sm`}
              >
                {current ? "Current plan" : isOwner ? `Switch to ${plan.label}` : "Owner only"}
              </button>
            </div>
          );
        })}
      </div>

      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <p className="text-[12px] leading-relaxed text-faint">
        Plans and seat limits are enforced server-side. Payments aren&apos;t wired yet; connect Stripe to make upgrades
        self-serve (see docs/DEPLOYMENT.md).
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ownership transfer                                                         */
/* -------------------------------------------------------------------------- */
export function TransferOwnershipPanel({ members, isOwner }: { members: Member[]; isOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const candidates = members.filter((m) => m.role !== "owner");
  const [target, setTarget] = useState(candidates[0]?.userId ?? "");

  if (!isOwner || candidates.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="field">
        <label htmlFor="newOwner">New owner</label>
        <select id="newOwner" value={target} onChange={(event) => setTarget(event.target.value)}>
          {candidates.map((m) => (
            <option key={m.userId} value={m.userId}>
              {displayName(m.profile.fullName)} ({m.role})
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await transferOwnershipAction(target);
            if (result.error) setMessage({ tone: "error", text: result.error });
            else if (result.message) setMessage({ tone: "success", text: result.message });
            router.refresh();
          })
        }
        className="btn-outline btn-sm"
      >
        {pending ? "Transferring…" : "Transfer ownership"}
      </button>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <p className="text-[12px] leading-relaxed text-faint">
        You&apos;ll become an admin and lose owner-only powers. This can&apos;t be undone without the new owner&apos;s
        help.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Join link (the common, approval-gated way in)                              */
/* -------------------------------------------------------------------------- */
export function JoinLinkPanel({
  link,
  pendingCount,
  baseUrl,
}: {
  link: JoinLink;
  pendingCount: number;
  /** Server-side origin, so the copy button works before hydration too. */
  baseUrl?: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(link.enabled);
  const [origin, setOrigin] = useState(baseUrl ?? "");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = `${origin}/join/${link.token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy. Select the link and copy it manually.");
    }
  }

  function toggle(next: boolean) {
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      const result = await setJoinLinkEnabledAction(next);
      if (result.error) {
        setEnabled(!next);
        setError(result.error);
        return;
      }
      setMessage(result.message ?? null);
      router.refresh();
    });
  }

  function rotate() {
    if (!window.confirm("Create a new link? Anyone still holding the old one will lose access.")) return;
    startTransition(async () => {
      const result = await rotateJoinLinkAction();
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] leading-relaxed text-muted">
        One link for everyone. Anyone with it can ask to join, and you approve them from the
        dashboard. Nobody gets in on their own.
      </p>

      <div className="flex items-center gap-2 rounded-lg border border-line bg-[#fbfaf8] px-2.5 py-2">
        <input
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] text-ink-2 outline-none"
          aria-label="Join link"
        />
        <button type="button" onClick={copy} className="btn-outline btn-sm shrink-0">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) => toggle(event.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-brand)]"
          />
          Accepting requests
        </label>
        <button
          type="button"
          onClick={rotate}
          disabled={busy}
          className="text-[12.5px] font-medium text-muted underline underline-offset-2 transition-colors hover:text-ink disabled:opacity-50"
        >
          New link
        </button>
        <span className="text-[12px] text-muted sm:ml-auto">
          {pendingCount
            ? `${pendingCount} waiting for approval`
            : "No requests waiting"}
        </span>
      </div>

      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
    </div>
  );
}
