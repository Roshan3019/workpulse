import Link from "next/link";
import { Avatar, EmptyState, Section } from "@/components/ui";
import { DAY_END_HOUR, DAY_START_HOUR, fromISODate, shortDate, todayISO, weekdayOf } from "@/lib/dates";
import { cellState } from "@/lib/availability";
import type { AvailabilityStates, Member } from "@/lib/types";

/**
 * "Team slots" — one screen showing when the whole studio is actually free.
 *
 * Everyone's week is folded into a single 7-day grid: each cell answers the
 * question an admin actually asks, which is not "am I free" but "can I put
 * someone on this hour". The number is how many people are free then, and the
 * green fills the cell as that number approaches the team size.
 *
 * Hours run 8am to 7pm, the same working window the availability grid uses,
 * so the two screens agree. Anything outside it is noise.
 */
const START = Math.max(DAY_START_HOUR, 8);
const END = Math.min(DAY_END_HOUR, 20);
const HOURS = Array.from({ length: END - START }, (_, i) => START + i);

/** 8a, 12p, 5p ... compact and unambiguous without a locale call. */
function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "a" : "p";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

export function TeamSlotGrid({
  members,
  availability,
  dates,
  title = "Team slots",
}: {
  members: Member[];
  availability: Record<string, AvailabilityStates>;
  dates: string[];
  title?: string;
}) {
  const week = dates.slice(0, 7);
  const total = members.length;
  const today = todayISO();

  // Fold every member's states into a count per (date, hour).
  const freeAt: Record<string, Record<number, number>> = {};
  for (const date of week) {
    freeAt[date] = {};
    for (const hour of HOURS) freeAt[date][hour] = 0;
  }
  for (const member of members) {
    const days = availability[member.userId] ?? {};
    for (const date of week) {
      for (const hour of HOURS) {
        if (cellState(days[date], hour) === "free") freeAt[date][hour] += 1;
      }
    }
  }

  const dayTotal = (date: string) =>
    HOURS.reduce((sum, h) => sum + freeAt[date][h], 0);

  // The single best hour of the week: most people free, earliest on a tie.
  let best: { date: string; hour: number; count: number } | null = null;
  for (const date of week) {
    for (const hour of HOURS) {
      const count = freeAt[date][hour];
      if (count > 0 && (!best || count > best.count)) best = { date, hour, count };
    }
  }

  return (
    <Section
      title={title}
      subtitle={`When the whole team is reachable · ${shortDate(week[0])} – ${shortDate(week[week.length - 1])}`}
      action={
        <Link href="/app/availability" className="btn-outline btn-sm">
          Open calendar
        </Link>
      }
    >
      {total === 0 ? (
        <EmptyState
          title="No freelancers yet"
          hint="Invite teammates and their hours will fold into one team view here."
          icon="👥"
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-[#fafaff] px-3.5 py-2.5 text-[12.5px] text-muted">
            <span>
              <b className="text-[15px] font-extrabold tabular-nums text-ink">{total}</b>{" "}
              {total === 1 ? "person" : "people"} on the team
            </span>
            {best ? (
              <span>
                Best slot:{" "}
                <b className="text-ink-2">
                  {weekdayOf(best.date)} {hourLabel(best.hour)}
                </b>{" "}
                <span className="text-faint">
                  ({best.count} of {total} free)
                </span>
              </span>
            ) : (
              <span className="font-semibold text-warn-dark">
                Nobody has marked a free hour this week yet
              </span>
            )}
            {/* The legend is three swatches, not a paragraph. */}
            <span className="ml-auto flex items-center gap-3">
              {[
                { label: "All free", className: "bg-ok" },
                { label: "Some", className: "bg-ok/35" },
                { label: "None", className: "border border-line-2 bg-[#eef1f8]" },
              ].map((key) => (
                <span key={key.label} className="inline-flex items-center gap-1.5 text-[11.5px]">
                  <i className={`h-2.5 w-2.5 rounded-[3px] ${key.className}`} aria-hidden="true" />
                  {key.label}
                </span>
              ))}
            </span>
          </div>

          <div className="scroll-x -mx-1 px-1 pb-1">
            <div className="min-w-[620px]">
              {/* day headers */}
              <div className="flex items-end gap-1.5 pb-2">
                <div className="w-11 shrink-0" aria-hidden="true" />
                {week.map((date) => {
                  const isToday = date === today;
                  return (
                    <div key={date} className="min-w-0 flex-1 text-center">
                      <div
                        className={`text-[10.5px] font-extrabold tracking-[.06em] uppercase ${
                          isToday ? "text-brand" : "text-faint"
                        }`}
                      >
                        {weekdayOf(date)}
                      </div>
                      <div className={`text-[12px] font-bold ${isToday ? "text-brand" : "text-ink-2"}`}>
                        {fromISODate(date).getDate()}
                      </div>
                    </div>
                  );
                })}
                <div className="w-12 shrink-0" />
              </div>

              {/* one row per hour */}
              {HOURS.map((hour) => (
                <div key={hour} className="flex items-center gap-1.5">
                  <div className="w-11 shrink-0 text-right text-[10.5px] font-semibold tabular-nums text-faint">
                    {hourLabel(hour)}
                  </div>
                  {week.map((date) => {
                    const count = freeAt[date][hour];
                    const isToday = date === today;
                    const ratio = total ? count / total : 0;
                    return (
                      <div
                        key={date}
                        title={`${weekdayOf(date)} ${hourLabel(hour)} · ${count} of ${total} free`}
                        className={`h-6 min-w-0 flex-1 rounded-[5px] ${
                          isToday ? "ring-1 ring-brand/25" : ""
                        } ${
                          count === 0
                            ? "border border-line-2/70 bg-[#eef1f8]"
                            : "bg-ok"
                        }`}
                        style={count > 0 ? { opacity: 0.22 + ratio * 0.78 } : undefined}
                      >
                        {count > 0 ? (
                          <span className="grid h-full place-items-center text-[10px] font-bold tabular-nums text-white">
                            {count}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                  <div className="w-12 shrink-0" />
                </div>
              ))}

              {/* free-hour totals per day */}
              <div className="mt-2 flex items-center gap-1.5 border-t border-line pt-2">
                <div className="w-11 shrink-0" aria-hidden="true" />
                {week.map((date) => (
                  <div
                    key={date}
                    className="min-w-0 flex-1 text-center text-[11px] font-bold tabular-nums text-ink-2"
                  >
                    {dayTotal(date)}h
                  </div>
                ))}
                <div className="w-12 shrink-0 text-right text-[10.5px] font-semibold text-faint">
                  free
                </div>
              </div>
            </div>
          </div>

          {/* Who is actually free at the best slot, by name. */}
          {best ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-muted">
                Free at {weekdayOf(best.date)} {hourLabel(best.hour)}:
              </span>
              {members
                .filter((m) => cellState(availability[m.userId]?.[best!.date], best!.hour) === "free")
                .map((m) => (
                  <span
                    key={m.userId}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-0.5 pl-0.5 pr-2.5 text-[12px] font-semibold text-ink-2"
                  >
                    <Avatar
                      id={m.userId}
                      name={m.profile.fullName}
                      email={m.profile.email}
                      src={m.profile.avatarUrl}
                      size={20}
                    />
                    {m.profile.fullName?.split(" ")[0] ?? m.profile.email}
                  </span>
                ))}
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}
