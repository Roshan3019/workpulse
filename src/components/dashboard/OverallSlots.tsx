import { Avatar, Badge, EmptyState, Section } from "@/components/ui";
import { dayLabel, shortDate } from "@/lib/dates";
import { computeFreeSlots, teamTotals } from "@/lib/workload";
import type { AvailabilityMap, Member } from "@/lib/types";

function heatStyle(hours: number) {
  if (hours === 0) return { className: "bg-[#f1f3f9] text-faint", label: "0h" };
  if (hours <= 3) return { className: "bg-[#bfe9d6] text-[#065f46]", label: `${hours}h` };
  if (hours <= 6) return { className: "bg-[#6ee7b7] text-[#064e3b]", label: `${hours}h` };
  return { className: "bg-ok text-white", label: `${hours}h` };
}

/**
 * "Overall time slots" — the plain-language availability overview admins asked
 * for: one heatmap, three summary tiles, and exact free ranges per person.
 */
export function OverallSlots({
  members,
  availability,
  dates,
  title = "Overall time slots",
}: {
  members: Member[];
  availability: Record<string, AvailabilityMap>;
  dates: string[];
  title?: string;
}) {
  const rows = computeFreeSlots(members, availability, dates);
  const { total, most, least, unset } = teamTotals(rows);

  return (
    <Section
      title={title}
      subtitle={`Everyone's free hours for the next ${dates.length} days — greener means more free. Read-only: freelancers edit their own calendar.`}
      action={<Badge tone="indigo">{shortDate(dates[0])} – {shortDate(dates[dates.length - 1])}</Badge>}
    >
      {members.length === 0 ? (
        <EmptyState title="No freelancers yet" hint="Invite teammates from Settings to see their free hours here." icon="👥" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-line bg-[#fafaff] px-4 py-3.5">
              <div className="label">Team total free</div>
              <div className="mt-1 text-xl font-extrabold">{total}h</div>
              <div className="mt-0.5 text-[12px] text-faint">Across {members.length} freelancers</div>
            </div>
            <div className="rounded-2xl border border-line bg-[#fafaff] px-4 py-3.5">
              <div className="label">Most available</div>
              <div className="mt-1 truncate text-xl font-extrabold">
                {most ? (most.member.profile.fullName?.split(" ")[0] ?? most.member.profile.email) : "—"}
              </div>
              <div className="mt-0.5 text-[12px] text-faint">{most ? `${most.total}h free this week` : ""}</div>
            </div>
            <div className="rounded-2xl border border-line bg-[#fafaff] px-4 py-3.5">
              <div className="label">Needs attention</div>
              <div className="mt-1 truncate text-xl font-extrabold">
                {unset > 0 ? `${unset} without hours` : least ? (least.member.profile.fullName?.split(" ")[0] ?? "—") : "—"}
              </div>
              <div className="mt-0.5 text-[12px] text-faint">
                {unset > 0 ? "Hasn't set availability yet" : least ? `${least.total}h free this week` : ""}
              </div>
            </div>
          </div>

          <div className="scroll-x mt-4 rounded-2xl border border-line">
            <table className="w-full min-w-[720px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-[#fafaff] px-3 py-2.5 text-left text-[11px] font-extrabold tracking-[.06em] text-muted uppercase">
                    Freelancer
                  </th>
                  {dates.map((date) => (
                    <th key={date} className="bg-[#fafaff] px-2 py-2.5 text-center text-[11px] font-extrabold tracking-[.06em] text-muted uppercase">
                      {dayLabel(date)}
                    </th>
                  ))}
                  <th className="bg-[#fafaff] px-2 py-2.5 text-center text-[11px] font-extrabold tracking-[.06em] text-muted uppercase">
                    Week
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.member.id} className="border-t border-[#f0f1f7]">
                    <td className="sticky left-0 z-10 border-b border-[#f0f1f7] bg-white px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar id={row.member.userId} name={row.member.profile.fullName} email={row.member.profile.email} size={30} />
                        <div className="min-w-0">
                          <div className="truncate text-[13.5px] font-bold">{row.member.profile.fullName ?? "Unnamed"}</div>
                          <div className="truncate text-[11px] text-muted">{row.member.profile.email}</div>
                        </div>
                      </div>
                    </td>
                    {row.perDay.map((hours, i) => {
                      const heat = heatStyle(hours);
                      return (
                        <td key={dates[i]} className="border-b border-[#f0f1f7] px-1.5 py-2 text-center">
                          <span className={`inline-block min-w-[42px] rounded-lg px-2 py-1 text-[12.5px] font-bold ${heat.className}`}>
                            {heat.label}
                          </span>
                        </td>
                      );
                    })}
                    <td className="border-b border-[#f0f1f7] px-2 py-2 text-center text-[13.5px] font-extrabold">{row.total}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[12.5px] text-muted">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-3.5 w-3.5 rounded bg-ok" /> 7h+ free
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-3.5 w-3.5 rounded bg-[#6ee7b7]" /> 4–6h
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-3.5 w-3.5 rounded bg-[#bfe9d6]" /> 1–3h
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-3.5 w-3.5 rounded bg-[#f1f3f9]" /> Busy / unset
            </span>
          </div>

          {/* exact ranges — the bit people actually read */}
          <details className="group mt-4 rounded-2xl border border-line bg-white px-4 py-3" open>
            <summary className="cursor-pointer list-none text-[13px] font-extrabold text-ink-2">
              Exact free ranges per person <span className="font-semibold text-muted group-open:hidden">(show)</span>
              <span className="hidden font-semibold text-muted group-open:inline">(hide)</span>
            </summary>
            <div className="mt-3 divide-y divide-[#f0f1f7]">
              {rows.map((row) => (
                <div key={row.member.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Avatar id={row.member.userId} name={row.member.profile.fullName} email={row.member.profile.email} size={26} />
                    <b className="text-[13.5px]">{row.member.profile.fullName ?? row.member.profile.email}</b>
                    <span className="text-[12px] text-muted">{row.total}h free · next {dates.length} days</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.rangesByDay.map((day) =>
                      day.hours.length ? (
                        <span key={day.date} className="rounded-full border border-[#bfe9d6] bg-ok-soft px-2.5 py-1 text-[12px] font-semibold text-[#065f46]">
                          {dayLabel(day.date)} · {day.text}
                        </span>
                      ) : (
                        <span key={day.date} className="rounded-full border border-line bg-[#f1f3f9] px-2.5 py-1 text-[12px] font-semibold text-faint">
                          {dayLabel(day.date)} · busy
                        </span>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </Section>
  );
}
