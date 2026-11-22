import { AvailabilityGrid } from "@/components/availability/AvailabilityGrid";
import { MemberPicker } from "@/components/availability/MemberPicker";
import { Avatar, Badge, EmptyState, Section } from "@/components/ui";
import { getStore } from "@/lib/data";
import { nextDates, shortDate } from "@/lib/dates";
import { requireSession } from "@/lib/session";
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
  const dates = nextDates(14);
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
            <h1 className="h1">Team availability</h1>
            <p className="lede">
              View-only. Freelancers set their own free hours — admins don&apos;t keep an availability calendar.
            </p>
          </div>
          {freelancers.length > 1 ? <MemberPicker members={freelancers} selected={selectedId} /> : null}
        </div>

        <div className="card flex flex-wrap items-start gap-2.5 border-brand-line bg-brand-soft p-4 text-[13px] leading-relaxed text-brand-dark">
          <span className="text-base">👁</span>
          <span>
            <b>View only.</b> You can see {selected ? selected.profile.fullName ?? "this teammate" : "a teammate"}
            &apos;s free slots for the next 14 days, but you can&apos;t edit them. They update this grid from their own
            Availability page — and the database blocks admins from writing availability rows at all.
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
          <h1 className="h1">My free hours</h1>
          <p className="lede">
            Pick a date, then <b>drag</b> across cells to paint free (green) or busy. Free next 7 days:{" "}
            <b>{freeNext7}h</b>
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
        <AvailabilityGrid mode="edit" dates={dates} initial={mine} />
      </Section>
    </div>
  );
}
