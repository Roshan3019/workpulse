import { AvailabilityGrid } from "@/components/availability/AvailabilityGrid";
import { MemberPicker } from "@/components/availability/MemberPicker";
import { Avatar, Badge, EmptyState, Section } from "@/components/ui";
import { getStore } from "@/lib/data";
import { orgMembers } from "@/lib/data/request-cache";
import { nextDatesIn, shortDate } from "@/lib/dates";
import { getUserTimeZone, requireSession } from "@/lib/session";
import { isAdminRole, type AvailabilityStates } from "@/lib/types";
import { applyWeeklyDefault, countStates } from "@/lib/availability";
import { displayName } from "@/lib/format";
import { WeeklyDefaultEditor } from "@/components/availability/WeeklyDefaultEditor";

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

  /* ------------------------------ ADMIN VIEW ------------------------------- */
  /*
   * The shape the client asked for: pick a person, read their whole week.
   * Every day still honours that person's usual-week default and their
   * free/busy/unassigned states, so nothing was lost in going back to this.
   */
  if (admin) {
    const [members, params] = await Promise.all([orgMembers(orgId), searchParams]);
    const freelancers = members.filter((m) => m.role === "member");
    const selectedId =
      params.member && freelancers.some((m) => m.userId === params.member)
        ? params.member
        : freelancers[0]?.userId ?? "";

    const selected = freelancers.find((m) => m.userId === selectedId);

    const stored: Record<string, AvailabilityStates> = selectedId
      ? await store.getAvailabilityStates(orgId, [selectedId], dates)
      : {};
    const weeklyDefault = selectedId ? await store.getWeeklyDefault(orgId, selectedId) : null;

    // Stored days win; days with no row inherit that person's usual week.
    const { states: shown } = applyWeeklyDefault(
      weeklyDefault,
      dates.slice(0, 14),
      stored[selectedId] ?? {},
    );
    const freeThisWeek = dates
      .slice(0, 7)
      .reduce((sum, d) => sum + countStates(shown[d] ?? {}).free, 0);

    return (
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="h1">Who&apos;s free when</h1>
            <p className="lede">
              Green is free, red is booked, grey isn&apos;t filled in. View only — everyone keeps
              their own calendar up to date.
            </p>
          </div>
          {freelancers.length > 1 ? (
            <MemberPicker members={freelancers} selected={selectedId} />
          ) : null}
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
            title={displayName(selected.profile.fullName)}
            subtitle={`${freeThisWeek}h free over the next 7 days`}
            action={
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone="indigo">
                  {shortDate(dates[0])} – {shortDate(dates[dates.length - 1])}
                </Badge>
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
              dates={dates.slice(0, 7)}
              today={today}
              initial={shown}
              emptyHint="this teammate edits their own calendar."
            />
          </Section>
        )}
      </div>
    );
  }

  /* --------------------------- MEMBER: editable ---------------------------- */
  const [availability, weeklyDefault] = await Promise.all([
    store.getAvailabilityStates(orgId, [session.membership.userId], dates),
    store.getWeeklyDefault(orgId, session.membership.userId),
  ]);
  const stored = availability[session.membership.userId] ?? {};

  /*
   * Days with no row of their own inherit the usual week. `mine` is what the
   * grid shows; `stored` is what's actually persisted — saving the grid writes
   * the inherited days as real entries, so an explicit edit always wins from
   * then on.
   */
  const { states: mine, fromDefault } = applyWeeklyDefault(weeklyDefault, dates.slice(0, 7), stored);
  const freeNext7 = dates
    .slice(0, 7)
    .reduce((sum, d) => sum + countStates(mine[d] ?? {}).free, 0);
  const usingDefault = fromDefault.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">When are you free?</h1>
          <p className="lede">
            Paint each hour free or busy. Any hour you leave blank reads as not filled in, and your admin sees this instantly.
          </p>
        </div>
        <Badge tone="green">{session.membership.capacity}h weekly capacity</Badge>
      </div>

      <WeeklyDefaultEditor initial={weeklyDefault} />

      {usingDefault ? (
        <p className="px-1 text-[12px] text-muted">
          {fromDefault.length} {fromDefault.length === 1 ? "day" : "days"} below are filled in from your
          usual week. Editing a day saves it as its own entry.
        </p>
      ) : null}

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
