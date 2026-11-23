import { AvailabilityGrid } from "@/components/availability/AvailabilityGrid";
import { Avatar, Badge, EmptyState, Section } from "@/components/ui";
import { getStore } from "@/lib/data";
import { orgMembers } from "@/lib/data/request-cache";
import { nextDatesIn, shortDate, weekdayOf } from "@/lib/dates";
import { getUserTimeZone, requireSession } from "@/lib/session";
import { isAdminRole, type AvailabilityStates, type WeeklyDefault } from "@/lib/types";
import { applyWeeklyDefault, countStates } from "@/lib/availability";
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
   * The client asked for one screen where an admin can read every member's
   * free/busy at a glance. So this is a roster, not a picker: each person is a
   * row with 7 day-cells, colour-coded, and clicking a name opens their full
   * week below.
   */
  if (admin) {
    const [members, params] = await Promise.all([orgMembers(orgId), searchParams]);
    const freelancers = members.filter((m) => m.role === "member");
    const userIds = freelancers.map((m) => m.userId);

    /*
     * Admins read the same fallback the member sees: stored days win, and any
     * day without a row inherits that person's usual week. Otherwise a member
     * with a default saved would look empty here while looking full to
     * themselves — the one thing this screen must never do.
     */
    const stored: Record<string, AvailabilityStates> = userIds.length
      ? await store.getAvailabilityStates(orgId, userIds, dates)
      : {};
    const defaults: (WeeklyDefault | null)[] = userIds.length
      ? await Promise.all(userIds.map((id) => store.getWeeklyDefault(orgId, id)))
      : [];
    const availability: Record<string, AvailabilityStates> = Object.fromEntries(
      userIds.map((id, index) => [
        id,
        applyWeeklyDefault(defaults[index] ?? null, dates.slice(0, 7), stored[id] ?? {}).states,
      ]),
    );

    const selectedId =
      params.member && freelancers.some((m) => m.userId === params.member) ? params.member : "";
    const selected = freelancers.find((m) => m.userId === selectedId);
    const week = dates.slice(0, 7);
    const weekLabel = `${shortDate(week[0])} – ${shortDate(week[week.length - 1])}`;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="h1">Availability</h1>
            <p className="lede">Who has room this week, and who is booked out.</p>
          </div>
          <span className="text-[12px] font-medium text-faint tabular-nums">{weekLabel}</span>
        </div>

        {!freelancers.length ? (
          <div className="card">
            <EmptyState
              title="No freelancers yet"
              hint="Availability appears once people join your studio."
            />
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-line bg-white">
              {/* header row */}
              <div className="hidden items-center gap-3 border-b border-line bg-[#fcfcfe] px-4 py-2.5 text-[11px] font-medium tracking-[.04em] text-faint uppercase sm:flex">
                <span className="flex-1">Person</span>
                <span className="flex w-[266px] shrink-0 items-center justify-between">
                  {week.map((date) => (
                    <span key={date} className="w-[34px] text-center">
                      {weekdayOf(date).slice(0, 2)}
                    </span>
                  ))}
                </span>
                <span className="w-[72px] shrink-0 text-right">Free</span>
              </div>

              {freelancers.map((m) => {
                const days = availability[m.userId] ?? {};
                const totalFree = week.reduce((n, d) => n + countStates(days[d] ?? {}).free, 0);
                const open = selectedId === m.userId;
                return (
                  <div
                    key={m.userId}
                    className={`border-b border-line last:border-b-0 ${open ? "bg-[#fbfaf8]" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:flex-nowrap">
                      <a
                        href={`/app/availability?member=${m.userId}`}
                        className="flex min-w-0 flex-1 items-center gap-2.5"
                      >
                        <Avatar
                          id={m.userId}
                          name={m.profile.fullName}
                          email={m.profile.email}
                          src={m.profile.avatarUrl}
                          size={28}
                        />
                        <span className="truncate text-[13px] font-medium text-ink">
                          {m.profile.fullName ?? m.profile.email}
                        </span>
                      </a>

                      <span className="flex w-full items-center justify-between sm:w-[266px] sm:shrink-0">
                        {week.map((date) => {
                          const day = days[date] ?? {};
                          const c = countStates(day);
                          const total = c.free + c.busy;
                          const freePct = total ? Math.round((c.free / total) * 100) : 0;
                          return (
                            <span
                              key={date}
                              title={`${weekdayOf(date)}: ${c.free}h free, ${c.busy}h busy, ${c.unassigned}h unassigned`}
                              className={`relative flex h-8 w-[34px] overflow-hidden rounded-[5px] border ${
                                total === 0
                                  ? "items-center justify-center border-dashed border-line-2 bg-[#fbfaf8]"
                                  : "flex-col justify-end border-line"
                              }`}
                            >
                              {total === 0 ? (
                                <span className="text-[11px] leading-none text-faint">–</span>
                              ) : (
                                <>
                                  {/* One bar, two honest segments: the share of the day spoken for. */}
                                  <i
                                    className="absolute inset-x-0 top-0 bg-bad/35"
                                    style={{ height: `${100 - freePct}%` }}
                                    aria-hidden="true"
                                  />
                                  <i
                                    className="absolute inset-x-0 bottom-0 bg-ok/55"
                                    style={{ height: `${freePct}%` }}
                                    aria-hidden="true"
                                  />
                                </>
                              )}
                            </span>
                          );
                        })}
                      </span>

                      <span className="flex w-[72px] shrink-0 items-center justify-end gap-1.5">
                        <span className="text-[12.5px] font-medium tabular-nums text-ink-2">
                          {totalFree}h
                        </span>
                        <svg
                          viewBox="0 0 12 12"
                          aria-hidden="true"
                          className={`h-2.5 w-2.5 shrink-0 text-faint transition-transform duration-150 ${
                            open ? "rotate-90" : ""
                          }`}
                        >
                          <path
                            d="M4.5 2.5 8 6l-3.5 3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </div>

                    {open ? (
                      <div className="border-t border-line bg-white px-4 py-4">
                        <AvailabilityGrid
                          key={m.userId}
                          mode="read"
                          dates={dates}
                          today={today}
                          initial={days}
                          emptyHint="This teammate edits their own calendar."
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="px-1 text-[12px] text-faint">
              The bar fills with the share of each day that is free, and empties as it books up. Open
              a person to read their whole week.
            </p>
          </>
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
            Paint each hour free, busy or unassigned. Your admin sees this instantly.
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
