import { AvailabilityGrid } from "@/components/availability/AvailabilityGrid";
import { MemberPicker } from "@/components/availability/MemberPicker";
import { Avatar, Badge, EmptyState, Section } from "@/components/ui";
import { getStore } from "@/lib/data";
import { nextDatesIn, shortDate } from "@/lib/dates";
import { getUserTimeZone, requireSession } from "@/lib/session";
import { isAdminRole } from "@/lib/types";

export const metadata = { title: "Availability" };
export const dynamic = "force-dynamic";

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const session = await requireSession();
  const store = getStore();
  const orgId = session.organization.id;
  // Anchored to the viewer's timezone, so the window rolls over at their
  // midnight — not the server's (UTC on Vercel).
  const tz = await getUserTimeZone();
  const dates = nextDatesIn(14, tz);
  const today = dates[0];
  const admin = isAdminRole(session.membership.role);

  /* ---------------------------- ADMIN: view only ---------------------------- */
  if (admin) {
    const members = await store.listMembers(orgId);
    const freelancers = members.filter((m) => m.role === "member");
    const params = await searchParams;
    const selectedId =
      params.member && freelancers.some((m) => m.userId === params.member)
        ? params.member
        : freelancers[0]?.userId ?? "";

    const selected = freelancers.find((m) => m.userId === selectedId);
    const availability = selectedId ? await store.getAvailability(orgId, [selectedId], dates) : {};

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="h1">Who&apos;s free when</h1>
            <p className="lede">Green means free. Pick a person to see their week at a glance.</p>
          </div>
          {freelancers.length > 1 ? <MemberPicker members={freelancers} selected={selectedId} /> : null}
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted">
          <span>👁</span>
          <span>
            <b className="text-ink-2">View only.</b> Teammates keep their own calendar up to date; admins read it here.
          </span>
        </div>

        {!selected ? (
          <div className="card">
            <EmptyState
              title="No freelancers yet"
              hint="Availability appears here once you invite members to your team."
              icon="📅"
            />
          </div>
        ) : (
          <Section
            title={selected.profile.fullName ?? selected.profile.email}
            subtitle={selected.profile.email}
            action={
              <div className="flex items-center gap-2">
                <Badge tone="indigo">{shortDate(dates[0])} – {shortDate(dates[dates.length - 1])}</Badge>
                <Avatar
                  id={selected.userId}
                  name={selected.profile.fullName}
                  email={selected.profile.email}
                  src={selected.profile.avatarUrl}
                  size={38}
                />
              </div>
            }
          >
            <AvailabilityGrid
              key={selectedId}
              mode="read"
              dates={dates}
              today={today}
              initial={availability[selectedId] ?? {}}
              emptyHint="this teammate edits their own calendar."
            />
          </Section>
        )}
      </div>
    );
  }

  /* --------------------------- MEMBER: editable ---------------------------- */
  const availability = await store.getAvailability(orgId, [session.membership.userId], dates);
  const mine = availability[session.membership.userId] ?? {};
  const freeNext7 = dates.slice(0, 7).reduce((sum, d) => sum + (mine[d]?.length ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">When are you free?</h1>
          <p className="lede">
            Paint the hours you&apos;re available this week. Your admin sees this instantly.
          </p>
        </div>
        <Badge tone="green">{session.membership.capacity}h weekly capacity</Badge>
      </div>

      <Section
        title={session.user.fullName ?? session.user.email}
        subtitle={session.user.email}
        action={
          <Avatar
            id={session.user.id}
            name={session.user.fullName}
            email={session.user.email}
            src={session.user.avatarUrl}
            size={38}
          />
        }
      >
        <AvailabilityGrid mode="edit" dates={dates} today={today} initial={mine} />
      </Section>
    </div>
  );
}
