import Link from "next/link";
import { Avatar, EmptyState, Section } from "@/components/ui";
import { dayLabel, hourLabel, shortDate, weekdayOf } from "@/lib/dates";
import { dayStates } from "@/lib/availability";
import { dayBlocks, mergePlansIntoStates, minutesLabel, type DayBlock } from "@/lib/plans";
import type { AvailabilityStates, Member, PlannedBlock } from "@/lib/types";

/**
 * "Team slots" — one day, one row per teammate, one column per working hour.
 *
 * The client's brief, in their words: the admin reads names down the left and
 * the day's hours across the top, and each cell says free / busy / unassigned.
 * So this is a table, not a heat-map: the week view answered "how busy is the
 * studio", this answers "who can I put on this job at 2pm".
 *
 * The hour rule never scrolls sideways. Twelve columns fit a desktop, so from
 * `lg` up all of them show; below that it thins out to every other, then every
 * third hour. Row totals and the whole-day bar always count all twelve, so the
 * same day reads identically on a phone and a monitor.
 */

/** Working window, 8am to 7pm — the same one the availability grid paints. */
const FIRST_HOUR = 8;
const LAST_HOUR = 19;

const ALL_HOURS: number[] = Array.from(
  { length: LAST_HOUR - FIRST_HOUR + 1 },
  (_, i) => FIRST_HOUR + i,
);

const STATE_LABEL: Record<string, string> = {
  free: "Free",
  busy: "Busy",
  unassigned: "Not filled in",
  planned: "Planned for a task",
  "planned-busy": "Planned for a task (was marked busy)",
};

/** A block's tooltip: the task name(s), the hours, and how much work is in it. */
function blockTitle(block: DayBlock): string {
  const names = block.titles.join(" · ");
  const effort = block.minutes ? ` · ${minutesLabel(block.minutes)} of work` : "";
  const overlap = block.titles.length > 1 ? " (two tasks share this time)" : "";
  return `${names} · ${block.startHour}:00–${block.endHour}:00${effort}${overlap}`;
}

/** "Mon · Nov 23 · today" when it really is today. */
function dayTitle(date: string, today: string): string {
  return `${weekdayOf(date)} · ${shortDate(date)}${date === today ? " · today" : ""}`;
}

export function TeamSlotGrid({
  members,
  availability,
  plans = [],
  date,
  dates,
  today,
  title = "Team slots",
  current,
}: {
  members: Member[];
  availability: Record<string, AvailabilityStates>;
  /**
   * Every planned block for the visible days. The grid lays them over the
   * availability it is given, so a member who planned 2pm–6pm shows one long
   * bar with the task's name — the client's example, exactly.
   */
  plans?: PlannedBlock[];
  /** The day on screen. */
  date: string;
  /** The 7 days the picker offers. */
  dates: string[];
  /** The viewer's local today, resolved on the server. */
  today: string;
  title?: string;
  /** `?team=` slug carried along, so switching teams keeps the whole view. */
  current?: string | null;
}) {
  const total = members.length;

  /*
   * Totals always describe the whole working day, never just the columns a
   * narrow screen happens to show — otherwise the same person would read as
   * "4h free" on a phone and "9h free" on a desktop.
   */
  /*
   * Plans are per person. Grouping once, up front, is what keeps one member's
   * planned bar from appearing on everybody's row — the bug this shape exists
   * to prevent (`dayBlocks` filters by day, not by who planned it).
   */
  const plansByUser = new Map<string, PlannedBlock[]>();
  for (const plan of plans) {
    const list = plansByUser.get(plan.userId) ?? [];
    list.push(plan);
    plansByUser.set(plan.userId, list);
  }

  const rows = members.map((member) => {
    const blocks = dayBlocks(
      plansByUser.get(member.userId) ?? [],
      date,
      availability[member.userId]?.[date] ?? {},
    );
    /*
     * A planned hour *is* busy (the client's rule), so the merged view is what
     * the row paints and counts. The blocks list stays alongside it so each
     * cell knows which bar it belongs to and can drop its gutter.
     */
    const states = mergePlansIntoStates(availability[member.userId]?.[date] ?? {}, blocks);
    const counts = { free: 0, busy: 0, planned: 0 };
    for (const hour of ALL_HOURS) {
      const state = states[hour] ?? "unassigned";
      if (state === "free") counts.free += 1;
      else if (state === "busy") counts.busy += 1;
      else if (state === "planned" || state === "planned-busy") counts.planned += 1;
    }
    const blockAt = (hour: number): DayBlock | undefined =>
      blocks.find((b) => b.startHour <= hour && b.endHour > hour);
    return { member, states, counts, blocks, blockAt };
  });

  const freeAt = (hour: number) =>
    rows.filter(({ states }) => (states[hour] ?? "unassigned") === "free").length;

  /*
   * The hour rule thins out rather than scrolling sideways: every other hour on
   * a phone (8, 10, 12, 2, 4, 6), the full twelve from `lg`. Each column is
   * rendered once and hidden at the breakpoints where it would not fit, so the
   * header, the rows and the count line always agree — they all ask this.
   */
  const shown = (hour: number) => {
    const i = hour - FIRST_HOUR;
    if (i % 2 === 0) return ""; // visible everywhere: 8, 10, 12, 2, 4, 6
    return i % 3 === 0 ? "hidden sm:block" : "hidden lg:block"; // 9, 3, 7 from sm; 11, 1, 5 at lg
  };
  const hourFree = ALL_HOURS.map(freeAt);
  const allHourFree = ALL_HOURS.map(freeAt);
  const bestCount = Math.max(0, ...allHourFree);
  const bestHour = bestCount > 0 ? ALL_HOURS[allHourFree.indexOf(bestCount)] : null;
  const totalFree = allHourFree.reduce((sum, n) => sum + n, 0);
  const fullyFree = allHourFree.filter((n) => n === total).length;
  const plannedToday = rows.reduce((sum, row) => sum + row.blocks.length, 0);

  /* Switching days keeps the team filter and lands back on this card. */
  const dayLink = (target: string) => {
    const params = new URLSearchParams();
    if (current) params.set("team", current);
    params.set("day", target);
    return `/app?${params.toString()}#team-slots`;
  };

  return (
    <Section
      title={title}
      subtitle={`${dayTitle(date, today)} · who is free, busy or not filled in`}
      action={
        <Link href="/app/availability" className="btn-outline btn-sm">
          Open calendar
        </Link>
      }
    >
      {/* ---------------- day picker: 7 days, one click each ---------------- */}
      <nav aria-label="Pick a day" className="mb-4 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {dates.map((d) => {
          const active = d === date;
          const isToday = d === today;
          return (
            <Link
              key={d}
              href={dayLink(d)}
              scroll={false}
              aria-current={active ? "page" : undefined}
              aria-label={`${weekdayOf(d)} ${shortDate(d)}${isToday ? ", today" : ""}`}
              className={`flex h-11 flex-col items-center justify-center rounded-[8px] border text-center transition-colors duration-150 ${
                active
                  ? "border-brand bg-brand text-white"
                  : "border-line-2 bg-white text-ink-2 hover:border-[#c9c2b6] hover:bg-[#fbfaf8]"
              }`}
            >
              <span
                className={`text-[10px] font-medium tracking-[.06em] uppercase ${
                  active ? "text-white/80" : isToday ? "text-brand" : "text-faint"
                }`}
              >
                {weekdayOf(d)}
              </span>
              <span className="text-[13px] leading-tight font-semibold tabular-nums">
                {Number(d.slice(8, 10))}
              </span>
            </Link>
          );
        })}
      </nav>

      {total === 0 ? (
        <EmptyState
          title="No freelancers yet"
          hint="Invite teammates and their hours will show up here, one row each."
          icon="👥"
        />
      ) : (
        <>
          {/* ---------------- the day at a glance ---------------- */}
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-[#fbfaf8] px-3.5 py-2.5 text-[12.5px] text-muted">
            <span>
              <b className="text-[15px] font-semibold tabular-nums text-ink">{total}</b>{" "}
              {total === 1 ? "person" : "people"} on the team
            </span>
            <span>
              {bestHour !== null ? (
                <>
                  Busiest window:{" "}
                  <b className="text-ink-2">
                    {hourLabel(bestHour)}–{hourLabel(bestHour + 1)}
                  </b>{" "}
                  <span className="text-faint">
                    ({bestCount} of {total} free)
                  </span>
                </>
              ) : (
                <span className="font-medium text-warn-dark">Nobody is free on this day yet</span>
              )}
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-3">
              {(
                [
                  { label: "Free", state: "free" },
                  { label: "Busy", state: "busy" },
                  { label: "Unassigned", state: "unassigned" },
                  { label: "Task", state: "planned" },
                ] as const
              ).map((key) => (
                <span key={key.label} className="inline-flex items-center gap-1.5 text-[11.5px]">
                  <i
                    className="slot h-2.5 w-2.5 rounded-[3px]"
                    data-state={key.state}
                    aria-hidden="true"
                  />
                  {key.label}
                </span>
              ))}
            </span>
          </div>

          {/* ---------------- names × hours ---------------- */}
          <div className="pb-1">
            {/* hour ruler */}
            <div className="flex items-center gap-1 pb-1.5">
              <div className="w-[88px] shrink-0 pr-2 text-[10.5px] font-medium tracking-[.06em] text-faint uppercase sm:w-[132px]">
                <span className="hidden sm:inline">Teammate</span>
              </div>
              {ALL_HOURS.map((hour) => (
                <div
                  key={hour}
                  className={`min-w-0 flex-1 text-center text-[10px] font-semibold tabular-nums text-faint ${shown(hour)}`}
                >
                  {hourLabel(hour)}
                </div>
              ))}
              <div className="w-[40px] shrink-0 text-right text-[10px] font-semibold text-faint">
                Free
              </div>
            </div>

            {/* one row per teammate */}
            <ul className="divide-y divide-line border-t border-line">
              {rows.map(({ member, states, counts, blockAt }) => {
                const name = member.profile.fullName ?? member.profile.email;
                return (
                  <li key={member.userId} className="flex items-center gap-1 py-1.5">
                    <div className="flex w-[88px] shrink-0 items-center gap-1.5 pr-1.5 sm:w-[132px] sm:gap-2 sm:pr-2">
                      <Avatar
                        id={member.userId}
                        name={member.profile.fullName}
                        email={member.profile.email}
                        src={member.profile.avatarUrl}
                        size={22}
                      />
                      <span
                        className="min-w-0 truncate text-[12.5px] font-semibold text-ink"
                        title={name}
                      >
                        {name}
                      </span>
                    </div>

                    {ALL_HOURS.map((hour) => {
                      const state = states[hour] ?? "unassigned";
                      const block = blockAt(hour);
                      /*
                       * One continuous bar per block. Only the first cell shows
                       * the task name, the middle cells lose their gutter, and
                       * the last cell closes the bar off — so 2pm–6pm reads as
                       * one long block, which is what the client asked for.
                       */
                      const edge = block
                        ? block.startHour === hour
                          ? block.endHour === hour + 1
                            ? "only"
                            : "first"
                          : block.endHour === hour + 1
                            ? "last"
                            : "middle"
                        : undefined;
                      return (
                        <div
                          key={hour}
                          className={`slot relative min-w-0 flex-1 overflow-hidden ${shown(hour)}`}
                          data-state={state}
                          data-plan={edge}
                          title={
                            block
                              ? `${name} · ${blockTitle(block)}`
                              : `${name} · ${hourLabel(hour)}–${hourLabel(hour + 1)} · ${STATE_LABEL[state] ?? state}`
                          }
                        >
                          {edge === "first" || edge === "only" ? (
                            <span className="pointer-events-none absolute inset-0 flex items-center gap-1 px-1.5 text-[10px] leading-none font-semibold text-white">
                              <span className="truncate">{block!.label}</span>
                              {block!.minutes ? (
                                <span className="ml-auto shrink-0 text-[9.5px] font-medium text-white/80 tabular-nums">
                                  {minutesLabel(block!.minutes)}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                          <span className="sr-only">
                            {name}, {hourLabel(hour)}: {STATE_LABEL[state] ?? state}
                            {block ? ` — ${block.titles.join(", ")}` : ""}
                          </span>
                        </div>
                      );
                    })}

                    <div className="flex w-[40px] shrink-0 items-baseline justify-end gap-1 text-[11.5px] font-semibold tabular-nums">
                      <span className={counts.free ? "text-ink-2" : "text-faint"}>
                        {counts.free ? `${counts.free}h` : "—"}
                      </span>
                      {counts.busy ? (
                        <span className="text-[10px] font-semibold text-[#b91c1c]">
                          {counts.busy}b
                        </span>
                      ) : null}
                      {counts.planned ? (
                        <span className="text-[10px] font-semibold text-[#8a4a2c]">
                          {counts.planned}p
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* how many people are free in each visible hour */}
            <div className="mt-1 flex items-center gap-1 border-t border-line pt-2">
              <div className="w-[88px] shrink-0 pr-2 text-[10.5px] font-medium tracking-[.06em] text-faint uppercase sm:w-[132px]">
                Free in hour
              </div>
              {ALL_HOURS.map((hour, index) => {
                const count = hourFree[index];
                return (
                  <div
                    key={hour}
                    className={`min-w-0 flex-1 text-center text-[10.5px] font-semibold tabular-nums ${shown(hour)} ${
                      count === 0 ? "text-faint" : count === total ? "text-ok-dark" : "text-ink-2"
                    }`}
                  >
                    {count || "–"}
                  </div>
                );
              })}
              <div className="w-[40px] shrink-0" />
            </div>
          </div>

          <p className="mt-3 text-[12px] text-faint">
            {totalFree} {totalFree === 1 ? "free hour" : "free hours"} across the team on{" "}
            {dayLabel(date)}
            {fullyFree ? ` · ${fullyFree}h with everyone free` : ""}.
            {plannedToday
              ? ` ${plannedToday} ${plannedToday === 1 ? "block is" : "blocks are"} planned for tasks; hover one to see which.`
              : ""}
          </p>
        </>
      )}
    </Section>
  );
}
