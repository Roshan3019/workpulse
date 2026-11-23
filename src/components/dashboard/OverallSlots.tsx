import Link from "next/link";
import { Avatar, EmptyState, Section } from "@/components/ui";
import { dayLabel, shortDate, weekdayOf, fromISODate, todayISO } from "@/lib/dates";
import { computeFreeSlots, teamTotals } from "@/lib/workload";
import type { AvailabilityMap, Member } from "@/lib/types";

/**
 * "Who's free this week" — one calm table: a person, a 7-day strip, a total.
 * No heat-map legend, no nested panels: green means free, grey means not.
 */
export function OverallSlots({
  members,
  availability,
  dates,
  title = "Who's free this week",
}: {
  members: Member[];
  availability: Record<string, AvailabilityMap>;
  dates: string[];
  title?: string;
}) {
  const week = dates.slice(0, 7);
  const rows = computeFreeSlots(members, availability, week);
  const { total, most, unset } = teamTotals(rows);
  const today = todayISO();

  return (
    <Section
      title={title}
      subtitle={`Free hours for the next 7 days · ${shortDate(week[0])} – ${shortDate(week[week.length - 1])}`}
      action={
        <Link href="/app/availability" className="btn-outline btn-sm">
          Open calendar
        </Link>
      }
    >
      {members.length === 0 ? (
        <EmptyState
          title="No freelancers yet"
          hint="Invite teammates from Settings to see their free hours here."
        />
      ) : (
        <>
          {/* one-line summary instead of three big tiles */}
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl bg-[#fafaff] px-3.5 py-2.5 text-[12.5px] text-muted">
            <span>
              <b className="text-[15px] font-semibold tabular-nums text-ink">{total}h</b> free across the team
            </span>
            {most && most.total > 0 ? (
              <span>
                Most free: <b className="text-ink-2">{most.member.profile.fullName?.split(" ")[0] ?? "—"}</b>{" "}
                ({most.total}h)
              </span>
            ) : null}
            {unset > 0 ? (
              <span className="font-semibold text-warn-dark">
                {unset} {unset === 1 ? "person hasn't" : "people haven't"} set hours yet
              </span>
            ) : null}
          </div>

          <div className="scroll-x">
            <table className="w-full min-w-[640px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white px-0 py-2 text-left text-[10.5px] font-medium tracking-[.06em] text-faint uppercase">
                    Teammate
                  </th>
                  {week.map((date) => {
                    const isToday = date === today;
                    return (
                      <th
                        key={date}
                        className={`px-1 py-2 text-center text-[10.5px] font-medium tracking-[.06em] uppercase ${
                          isToday ? "text-brand" : "text-faint"
                        }`}
                      >
                        <span className="block">{weekdayOf(date)}</span>
                        <span className="block text-[11px] font-bold text-muted normal-case">
                          {fromISODate(date).getDate()}
                        </span>
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-right text-[10.5px] font-medium tracking-[.06em] text-faint uppercase">
                    Week
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.member.id}>
                    <td className="sticky left-0 z-10 border-t border-[#f0f1f7] bg-white py-2.5 pr-2">
                      <div className="flex items-center gap-2">
                        <Avatar
                          id={row.member.userId}
                          name={row.member.profile.fullName}
                          email={row.member.profile.email}
                          src={row.member.profile.avatarUrl}
                          size={28}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-bold">
                            {row.member.profile.fullName ?? row.member.profile.email}
                          </div>
                          <div className="truncate text-[10.5px] text-faint">{row.member.profile.email}</div>
                        </div>
                      </div>
                    </td>
                    {row.perDay.map((hours, i) => (
                      <td key={week[i]} className="border-t border-[#f0f1f7] px-1 py-2.5 text-center">
                        {hours > 0 ? (
                          <span className="inline-block min-w-[38px] rounded-md bg-ok-soft px-1.5 py-1 text-[11.5px] font-medium tabular-nums text-[#2f6b4a]">
                            {hours}h
                          </span>
                        ) : (
                          <span className="inline-block min-w-[38px] py-1 text-[11.5px] font-semibold text-faint">
                            —
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="border-t border-[#f0f1f7] px-2 py-2.5 text-right text-[12.5px] font-medium tabular-nums">
                      {row.total}h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* exact ranges: plain chips, one line per person */}
          <div className="mt-4 space-y-2.5">
            {rows.map((row) => (
              <div key={row.member.id} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="w-[110px] shrink-0 truncate text-[12.5px] font-medium text-ink-2">
                  {row.member.profile.fullName?.split(" ")[0] ?? row.member.profile.email}
                </span>
                {row.rangesByDay.every((d) => !d.hours.length) ? (
                  <span className="text-[12px] text-faint">No free hours marked this week</span>
                ) : (
                  row.rangesByDay
                    .filter((day) => day.hours.length)
                    .map((day) => (
                      <span
                        key={day.date}
                        className="rounded-full border border-[#d8e9de] bg-ok-soft px-2 py-0.5 text-[11.5px] font-semibold text-[#065f46]"
                      >
                        {dayLabel(day.date)} · {day.text}
                      </span>
                    ))
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
