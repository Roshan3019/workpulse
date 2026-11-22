import { Section, Badge } from "@/components/ui";
import {
  InvitePanel,
  OrgNameForm,
  PlanPanel,
  TransferOwnershipPanel,
} from "@/components/settings/SettingsPanels";
import { getStore } from "@/lib/data";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { isAdminRole } from "@/lib/types";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  const store = getStore();
  const orgId = session.organization.id;
  const admin = isAdminRole(session.membership.role);
  const owner = session.membership.role === "owner";

  const members = await store.listMembers(orgId);
  const invites = admin ? await store.listInvites(orgId) : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Settings</h1>
        <p className="lede">Workspace, people and plan for {session.organization.name}.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge tone="indigo">{session.organization.plan} plan</Badge>
        <Badge tone="grey">
          {members.length}/{session.organization.seatLimit} seats
        </Badge>
        <Badge tone={env.demoMode ? "amber" : "green"}>{env.demoMode ? "Demo data" : "Supabase connected"}</Badge>
      </div>

      {admin ? (
        <>
          <Section title="Workspace" subtitle="Rename your team and check the workspace URL.">
            <OrgNameForm org={session.organization} canEdit={admin} />
          </Section>

          <Section
            title="Invite teammates"
            subtitle="Create a shareable link or tie an invite to an email address. Invitees join as members by default."
          >
            <InvitePanel
              invites={invites}
              seatsUsed={members.length}
              seatLimit={session.organization.seatLimit}
              canInvite={admin}
            />
          </Section>

          <Section title="Plan & seats" subtitle="Seat limits are enforced before an invite is created.">
            <PlanPanel org={session.organization} seatsUsed={members.length} isOwner={owner} />
          </Section>

          {owner ? (
            <Section title="Transfer ownership" subtitle="Hand the workspace to another teammate.">
              <TransferOwnershipPanel members={members} isOwner={owner} />
            </Section>
          ) : null}
        </>
      ) : (
        <Section title="Workspace" subtitle="Your team details. Ask an admin if something needs changing.">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-[#fafaff] px-4 py-3">
              <dt className="label">Team</dt>
              <dd className="mt-1 text-[14px] font-bold">{session.organization.name}</dd>
            </div>
            <div className="rounded-xl border border-line bg-[#fafaff] px-4 py-3">
              <dt className="label">Plan</dt>
              <dd className="mt-1 text-[14px] font-bold capitalize">
                {session.organization.plan} · {members.length}/{session.organization.seatLimit} seats
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[12.5px] leading-relaxed text-faint">
            Renaming the team, inviting people and changing the plan are admin-only actions.
          </p>
        </Section>
      )}

      <Section title="Account" subtitle="Your personal details in this workspace.">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-[#fafaff] px-4 py-3">
            <dt className="label">Name</dt>
            <dd className="mt-1 text-[14px] font-bold">{session.user.fullName ?? "—"}</dd>
          </div>
          <div className="rounded-xl border border-line bg-[#fafaff] px-4 py-3">
            <dt className="label">Email</dt>
            <dd className="mt-1 truncate text-[14px] font-bold">{session.user.email}</dd>
          </div>
          <div className="rounded-xl border border-line bg-[#fafaff] px-4 py-3">
            <dt className="label">Role</dt>
            <dd className="mt-1 text-[14px] font-bold capitalize">{session.membership.role}</dd>
          </div>
          <div className="rounded-xl border border-line bg-[#fafaff] px-4 py-3">
            <dt className="label">Weekly capacity</dt>
            <dd className="mt-1 text-[14px] font-bold">{session.membership.capacity}h</dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-faint">
          Profile editing and password changes are handled by Supabase Auth (email links) once connected.
        </p>
      </Section>
    </div>
  );
}
