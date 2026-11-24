import Link from "next/link";
import { Avatar, EmptyState, Section } from "@/components/ui";
import { dayLabel, hourLabel, shortDate, weekdayOf } from "@/lib/dates";
import { WORK_FIRST_HOUR, WORK_HOURS, dayStates } from "@/lib/availability";
import { distinctNames, firstName } from "@/lib/format";
import { minutesLabel, type DayBlock } from "@/lib/plans";
import type { AvailabilityStates, Member, PlannedBlock } from "@/lib/types";

/**
 * "Team slots" — one day, one row per teammate, one column per working hour.
 *
 * The client's brief, in their words: the admin reads names down the left and
 * the day's hours across the top, and each cell says free / busy / unassigned.
 * So this is a table, not a heat-map: the week view answered "how busy is the
 * studio", this answers "who can I put on this job at 2pm".
 *
 * Planned work is drawn as ONE block per plan:
 *   • a block three hours or longer is wide enough to carry the task's name, so
 *     the name is written across it (once, starting left);
 *   • a shorter block gets no text at all — just the solid bar and a hover /
 *     focus tooltip naming the task. Squeezing "Landing page" into a single
 *     44px cell was unreadable, and truncating it to "Landi…" was worse.
 * Both cases answer on hover, on keyboard focus and on tap.
 *
 * The hour rule never scrolls sideways. The full twelve columns show from `lg`
 * up; below that alternate/third columns are hidden. Totals and the day summary
 * always count all twelve, so the same day reads identically on a phone and a
 * monitor.
 */

/*
 * Working window: 8am to 7pm — the same twelve cells the availability grid
 * paints and the planner offers, imported rather than retyped. These three used
 * to hold their own copies; when one said 20 and another said 19, a block ending
 * at 7pm had no cell to end in on this grid.
 */
const FIRST_HOUR = WORK_FIRST_HOUR;
const ALL_HOURS = WORK_HOURS;

/** A block this long (3h+) has room to print its name on the row. */
const LABEL_MIN_HOURS = 3;

const STATE_LABEL: Record<string, string> = {
  free: "Free",
  busy: "Busy",
  unassigned: "Not filled in",
  planned: "Planned for a task",
  "planned-busy": "Planned for a task (was marked busy)",
};

const hoursLabel = (h: number) => hourLabel(Math.min(24, h));

/** "Landing page · 11a–7p · 8h block · 8h of work". */
function blockTooltip(block: DayBlock): string {
  const effort = block.minutes ? ` · ${minutesLabel(block.minutes)} of work` : "";
  return `${block.titles.join(" · ")} · ${hoursLabel(block.startHour)}–${hoursLabel(block.endHour)} · ${
    block.endHour - block.startHour
  }h block${effort}${block.titles.length > 1 ? " — two tasks share this time" : ""}`;
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
  namePool,
}: {
  members: Member[];
  /**
   * Everyone the filter could hide — used only to decide whether a name in this
   * grid is ambiguous. Defaults to the rows themselves.
   */
  namePool?: Member[];
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

  /* Plans are per person: grouping first keeps one member's bar off everyone else's row. */
  const plansByUser = new Map<string, PlannedBlock[]>();
  for (const plan of plans) {
    if (plan.date !== date) continue;
    const list = plansByUser.get(plan.userId) ?? [];
    list.push(plan);
    plansByUser.set(plan.userId, list);
  }

  /*
   * Each row is computed once: the raw availability, the planned blocks (one per
   * plan, or split where two plans overlap), and the state of every hour after
   * plans are laid over availability. The grid, the counts and the tooltip all
   * read this one object, so they cannot disagree.
   */
  const rows = members.map((member) => {
    const dayStatesRaw = dayStates(availability[member.userId], date);
    const blocks = blocksForDay(plansByUser.get(member.userId) ?? [], date, dayStatesRaw);
    const hourBlock = new Map<number, { block: DayBlock; edge: "only" | "first" | "middle" | "last" }>();
    for (const block of blocks) {
      for (let hour = block.startHour; hour < block.endHour; hour += 1) {
        hourBlock.set(hour, {
          block,
          edge:
            block.endHour - block.startHour === 1
              ? "only"
              : hour === block.startHour
                ? "first"
                : hour === block.endHour - 1
                  ? "last"
                  : "middle",
        });
      }
    }
    const counts = { free: 0, busy: 0, planned: 0 };
    for (const hour of ALL_HOURS) {
      const planned = hourBlock.has(hour);
      const state = dayStatesRaw[hour];
      if (planned) counts.planned += 1;
      else if (state === "free") counts.free += 1;
      else if (state === "busy") counts.busy += 1;
    }
    return { member, dayStatesRaw, blocks, hourBlock, counts };
  });

  const names = distinctNames(namePool ?? members);

  const freeAt = (hour: number) =>
    rows.filter(({ dayStatesRaw, hourBlock }) => !hourBlock.has(hour) && dayStatesRaw[hour] === "free").length;

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
                  Busiest free window:{" "}
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
                  { label: "Not filled in", state: "unassigned" },
                  { label: "Task", state: "planned" },
                ] as const
              ).map((key) => (
                <span key={key.label} className="inline-flex items-center gap-1.5 text-[11.5px]">
                  <i className="slot h-2.5 w-2.5 rounded-[3px]" data-state={key.state} aria-hidden="true" />
                  {key.label}
                </span>
              ))}
            </span>
          </div>

          {/* ---------------- names × hours ---------------- */}
          <div className="pb-1">
            {/* hour ruler */}
            <div className="flex items-center pb-1.5">
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
              <div className="w-[46px] shrink-0 text-right text-[10px] font-semibold text-faint">Free</div>
            </div>

            {/* one row per teammate */}
            <ul className="divide-y divide-line border-t border-line">
              {rows.map(({ member, dayStatesRaw, hourBlock, counts }) => {
                /*
                 * Two teammates can share a display name. `names` adds the
                 * email only where it is needed, so "Roshan Patel" twice stops
                 * looking like one row rendered twice.
                 */
                /* NB: `shown` is the column-visibility helper above — hence `label`. */
                const label = names.get(member.userId);
                const name = label?.name ?? firstName(member.profile.fullName, member.profile.email);
                return (
                  <li key={member.userId} className="flex items-center py-1.5">
                    <div className="flex w-[88px] shrink-0 items-center gap-1.5 pr-1.5 sm:w-[132px] sm:gap-2 sm:pr-2">
                      <Avatar
                        id={member.userId}
                        name={member.profile.fullName}
                        email={member.profile.email}
                        src={member.profile.avatarUrl}
                        size={22}
                      />
                      <span
                        className="min-w-0 truncate text-[12.5px] font-semibold leading-tight text-ink"
                        title={label?.hint ? `${label.name} · ${member.profile.email}` : name}
                      >
                        {name}
                        {label?.hint ? (
                          <span className="block truncate text-[10px] font-medium text-faint">{label.hint}</span>
                        ) : null}
                      </span>
                    </div>

                    {ALL_HOURS.map((hour) => {
                      const hit = hourBlock.get(hour);
                      const state = hit
                        ? dayStatesRaw[hour] === "busy"
                          ? "planned-busy"
                          : "planned"
                        : (dayStatesRaw[hour] ?? "unassigned");

                      /*
                       * A block is a run of cells, not a run of bars: the cells
                       * lose the gutter between them, the ends round off, and
                       * the name is printed once — on the second cell, so it
                       * never collides with the teammate's avatar — but only if
                       * the block is long enough for the text to fit.
                       */
                      const wide = hit ? hit.block.endHour - hit.block.startHour >= LABEL_MIN_HOURS : false;
                      const showLabel = hit && wide && hour === hit.block.startHour;
                      /* A one-cell block has nowhere to put a name; a two-cell
                         block can hold a very short one, so keep it on hover. */
                      return (
                        <div
                          key={hour}
                          /*
                           * Every cell keeps the same outer width: an unpainted
                           * cell carries its own 2px gutters, a planned one has
                           * none, so a block's cells touch and read as one bar
                           * while the columns stay aligned with the hour ruler.
                           */
                          className={`slot relative min-w-0 flex-1 ${hit ? "mx-0" : "mx-[2px]"} ${shown(hour)} ${
                            hit ? "group/bar peer/bar" : ""
                          } ${hit && hit.edge === "first" ? "z-10" : ""}`}
                          data-state={state}
                          data-plan={hit?.edge}
                          tabIndex={hit ? 0 : undefined}
                          aria-label={
                            hit
                              ? `${name}, ${hoursLabel(hit.block.startHour)} to ${hoursLabel(hit.block.endHour)}: ${hit.block.titles.join(", ")}`
                              : `${name}, ${hourLabel(hour)}: ${STATE_LABEL[state] ?? state}`
                          }
                          title={
                            hit
                              ? `${name} · ${blockTooltip(hit.block)}`
                              : `${name} · ${hourLabel(hour)}–${hourLabel(hour + 1)} · ${STATE_LABEL[state] ?? state}`
                          }
                        >
                          {showLabel ? (
                            /*
                             * The name starts in the first cell and is given the
                             * block's real width — exactly `span × cell` — so it
                             * can run across the whole bar instead of being cut
                             * off at the first cell's edge. Only from `lg`, where
                             * all twelve columns are visible and that multiplication
                             * is true; on a phone every block answers on hover/tap.
                             */
                            <span
                              className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden items-center gap-1.5 pl-1.5 lg:flex"
                              style={{ width: `calc(${hit!.block.endHour - hit!.block.startHour} * 100% - 6px)` }}
                            >
                              <span className="truncate text-[10px] leading-none font-semibold text-white">
                                {hit!.block.label}
                              </span>
                              <span className="shrink-0 text-[9.5px] leading-none font-medium text-white/75 tabular-nums">
                                {minutesLabel(hit!.block.minutes) || `${hit!.block.endHour - hit!.block.startHour}h`}
                              </span>
                            </span>
                          ) : null}
                          {/*
                            Hover, keyboard focus and tap all answer the same way:
                            a tooltip at the start of the bar naming the task(s) and
                            the hours. CSS `group-hover` needs no JavaScript, and
                            `focus-visible` covers keyboard users — which is also why
                            the block's cells are focusable.
                          */}
                          {hit && hit.edge === "first" ? (
                            <span
                              role="tooltip"
                              className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 hidden w-max max-w-[240px] rounded-lg bg-[#2a2724] px-2.5 py-1.5 text-[11.5px] leading-snug font-medium text-white shadow-lg group-hover/bar:block peer-focus-visible:block"
                            >
                              <span className="block font-semibold">{hit.block.titles.join(" · ")}</span>
                              <span className="block text-white/75">
                                {hoursLabel(hit.block.startHour)}–{hoursLabel(hit.block.endHour)}
                                {hit.block.minutes ? ` · ${minutesLabel(hit.block.minutes)} of work` : ""}
                              </span>
                            </span>
                          ) : null}
                        </div>
                      );
                    })}

                    {/*
                      The row total is free hours only. It used to share the
                      column with a letter-suffixed "4p" / "2b" ("planned" /
                      "busy"), which sat next to the "Free" header and read as
                      part of the number. Planned and busy hours are already on
                      the row as bars; the summary sentence underneath counts
                      them in words.
                    */}
                    <div className="flex w-[46px] shrink-0 items-baseline justify-end text-[11.5px] font-semibold tabular-nums">
                      <span className={counts.free ? "text-ink-2" : "text-faint"}>
                        {counts.free ? `${counts.free}h` : "—"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* how many people are free in each visible hour */}
            <div className="mt-1 flex items-center border-t border-line pt-2">
              <div className="w-[88px] shrink-0 pr-2 text-[10.5px] font-medium tracking-[.06em] text-faint uppercase sm:w-[132px]">
                Free in hour
              </div>
              {ALL_HOURS.map((hour, index) => {
                const count = allHourFree[index];
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
              <div className="w-[46px] shrink-0" />
            </div>
          </div>

          <p className="mt-3 text-[12px] text-faint">
            {totalFree} {totalFree === 1 ? "free hour" : "free hours"} across the team on {dayLabel(date)}
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

/**
 * One entry per planned block on a day.
 *
 * Kept local (rather than importing `dayBlocks`) so this component owns exactly
 * one grouping rule — by person, then by day — and the two cannot drift apart.
 * Overlapping plans are still split at their boundaries, so a cell can only ever
 * belong to one bar.
 */
function blocksForDay(
  plans: PlannedBlock[],
  date: string,
  availability: Record<number, "free" | "busy">,
): DayBlock[] {
  const onDay = plans.filter((p) => p.date === date);
  if (!onDay.length) return [];

  const edges = [...new Set(onDay.flatMap((p) => [p.startHour, p.endHour]))].sort((a, b) => a - b);
  const segments: { startHour: number; endHour: number; plans: PlannedBlock[] }[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const start = edges[i];
    const end = edges[i + 1];
    const covering = onDay.filter((p) => p.startHour <= start && p.endHour >= end);
    if (covering.length) segments.push({ startHour: start, endHour: end, plans: covering });
  }

  const merged: typeof segments = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    const same =
      last &&
      last.endHour === segment.startHour &&
      last.plans.length === segment.plans.length &&
      last.plans.every((p, i) => p.id === segment.plans[i]?.id);
    if (same) {
      last.endHour = segment.endHour;
      continue;
    }
    merged.push({ ...segment, plans: [...segment.plans] });
  }

  return merged.map((segment) => {
    const titles = [...new Set(segment.plans.map((p) => p.taskTitle))];
    const hours: number[] = [];
    for (let h = segment.startHour; h < segment.endHour; h += 1) hours.push(h);
    return {
      date,
      startHour: segment.startHour,
      endHour: segment.endHour,
      minutes: segment.plans.reduce((sum, p) => sum + Number(p.minutes || 0), 0),
      plans: segment.plans,
      label: titles.length > 1 ? `${titles[0]} +${titles.length - 1}` : (titles[0] ?? "Task"),
      titles,
      done: segment.plans.every((p) => p.taskStatus === "done"),
      overFree: hours.some((h) => availability[h] === "free"),
    };
  });
}
