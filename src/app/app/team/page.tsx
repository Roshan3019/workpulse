import Link from "next/link";
import { redirect } from "next/navigation";
import { TeamGrid } from "@/components/team/TeamGrid";
import { Badge, EmptyState, Section } from "@/components/ui";
import { getStore } from "@/lib/data";
import { orgMembers } from "@/lib/data/request-cache";
import { nextDatesIn } from "@/lib/dates";
import { getUserTimeZone, requireSession } from "@/lib/session";
import { isAdminRole } from "@/lib/types";
import { countStates } from "@/lib/availability";

export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await requireSession();
  if (!isAdminRole(session.membership.role)) redirect("/app/my-tasks");

  const store = getStore();
  const orgId = session.organization.id;
  const [members, tz] = await Promise.all([orgMembers(orgId), getUserTimeZone()]);
  const dates = nextDatesIn(7, tz);
  const memberIds = members.filter((m) => m.role === "member").map((m) => m.userId);
  const availability = await store.getAvailabilityStates(orgId, memberIds, dates);

  const freeHours = Object.fromEntries(
    Object.entries(availability).map(([userId, map]) => [
      userId,
      dates.reduce((sum, d) => sum + countStates(map[d] ?? {}).free, 0),
    ]),
  );

  const adminCount = members.filter((m) => m.role !== "member").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">Your team</h1>
          <p className="lede">
            {members.length} {members.length === 1 ? "person" : "people"} · {adminCount} admin
            {adminCount === 1 ? "" : "s"} · {session.organization.seatLimit} seat plan
          </p>
        </div>
        <Link href="/app/settings" className="btn-outline">
          Invite teammates
        </Link>
      </div>

      <Section
        title="Roles & capacity"
        subtitle="Admins manage tasks, roles and invites. Members only see their own tasks and their availability calendar."
        action={<Badge tone="grey">{members.filter((m) => m.role === "member").length} freelancers</Badge>}
      >
        {members.length === 0 ? (
          <EmptyState title="Nobody here yet" hint="Invite your first freelancer from Settings." icon="👥" />
        ) : (
          <TeamGrid
            members={members}
            currentUserId={session.user.id}
            currentRole={session.membership.role}
            freeHours={freeHours}
          />
        )}
      </Section>

      <div className="card border-brand-line bg-brand-soft p-4 text-[13px] leading-relaxed text-brand-dark">
        <b>How roles behave:</b> nobody can change their own role — including the owner. An admin can promote a member
        to admin or demote another admin, but only the owner can hand over ownership (Settings → Transfer ownership).
        Every rule is enforced in the database, not just the UI.
      </div>
    </div>
  );
}
