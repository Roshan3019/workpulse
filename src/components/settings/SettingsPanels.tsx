"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
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
import { PLANS, type Invite, type Member, type OrgRole, type Organization } from "@/lib/types";

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
}: {
  invites: Invite[];
  seatsUsed: number;
  seatLimit: number;
  canInvite: boolean;
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
        {full ? <span>Seat limit reached — upgrade the plan to invite more people.</span> : null}
      </div>

      {canInvite ? (
        <form action={action} className="grid gap-2.5 sm:grid-cols-[1fr_180px_auto]">
          <input
            name="email"
            type="email"
            placeholder="teammate@studio.com  ·  leave blank for a shareable link"
            className="rounded-xl border border-line-2 border-[#dde1ee] px-3.5 py-3 text-sm outline-none focus:border-brand"
          />
          <select name="role" defaultValue="member" className="rounded-xl border border-line-2 px-3.5 py-3 text-sm font-semibold outline-none focus:border-brand">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" disabled={pending || full} className="btn-primary">
            {pending ? "Creating…" : "Create invite"}
          </button>
        </form>
      ) : (
        <Alert tone="info">Only owners and admins can invite teammates.</Alert>
      )}

      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.token ? (
        <div className="rounded-xl border border-[#bfe9d6] bg-ok-soft px-3.5 py-3 text-[13px] text-[#065f46]">
          <b>Invite ready.</b> <span className="font-normal">{state.message}</span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white px-2 py-1 text-[12px] break-all">{`${origin}/invite/${state.token}`}</code>
            <button type="button" onClick={() => copy(state.token!)} className="rounded-lg bg-white px-2.5 py-1 text-[12px] font-bold text-ok-dark">
              {copied === state.token ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      {invites.length ? (
        <div className="divide-y divide-[#f0f1f7] rounded-xl border border-line">
          {invites.map((invite) => (
            <div key={invite.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-[13px]">
              <span className="font-semibold">{invite.email ?? "Shareable link"}</span>
              <Badge tone={invite.role === "admin" ? "amber" : "grey"}>{invite.role}</Badge>
              <span className="text-[12px] text-faint">
                expires {new Date(invite.expiresAt).toLocaleDateString()}
              </span>
              <span className="ml-auto flex items-center gap-2">
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
              <div className="mt-1.5 text-[24px] font-extrabold tracking-[-0.02em]">
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
        Plans and seat limits are enforced server-side. Payments aren&apos;t wired yet — connect Stripe to make upgrades
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
              {m.profile.fullName ?? m.profile.email} ({m.role})
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
