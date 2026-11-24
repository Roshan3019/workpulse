import { assigneesOf, type AvailabilityMap, type Member, type Task } from "./types";
import { hoursToRanges, nextDates } from "./dates";

export type Utilisation = "available" | "balanced" | "busy" | "overloaded";

export const UTILISATION_LABEL: Record<Utilisation, string> = {
  available: "Available",
  balanced: "Balanced",
  busy: "Busy",
  overloaded: "Overloaded",
};

export const UTILISATION_TONE: Record<Utilisation, "green" | "indigo" | "amber" | "red"> = {
  available: "green",
  balanced: "indigo",
  busy: "amber",
  overloaded: "red",
};

export interface MemberWorkload {
  member: Member;
  assignedHours: number;
  capacity: number;
  /** 0..N — rounded integer percentage, may exceed 100 */
  utilisation: number;
  state: Utilisation;
  openTasks: number;
}

export function stateFor(utilisation: number): Utilisation {
  if (utilisation >= 100) return "overloaded";
  if (utilisation >= 75) return "busy";
  if (utilisation >= 40) return "balanced";
  return "available";
}

/** Open (not-done) hours assigned to each member. */
export function computeWorkload(members: Member[], tasks: Task[]): MemberWorkload[] {
  return members
    .map((member) => {
      /*
       * A shared task counts against everyone on it. Splitting the estimate
       * would be guesswork — the honest reading is "this person has these open
       * hours coming", whoever else is also on them.
       */
      const open = tasks.filter((t) => assigneesOf(t).includes(member.userId) && t.status !== "done");
      const assignedHours = open.reduce((sum, t) => sum + Number(t.estHours || 0), 0);
      const capacity = member.capacity || 40;
      const utilisation = capacity > 0 ? Math.round((assignedHours / capacity) * 100) : 0;
      return {
        member,
        assignedHours: Math.round(assignedHours * 10) / 10,
        capacity,
        utilisation,
        state: stateFor(utilisation),
        openTasks: open.length,
      };
    })
    .sort((a, b) => b.utilisation - a.utilisation);
}

export interface FreeSlotRow {
  member: Member;
  /** hours free per date, aligned with the dates array */
  perDay: number[];
  total: number;
  rangesByDay: { date: string; hours: number[]; text: string }[];
}

/** Aggregate availability for the dashboard "overall time slots" section. */
export function computeFreeSlots(
  members: Member[],
  availability: Record<string, AvailabilityMap>,
  dates: string[],
): FreeSlotRow[] {
  return members
    .map((member) => {
      const map = availability[member.userId] ?? {};
      const perDay = dates.map((d) => (map[d] ?? []).length);
      const total = perDay.reduce((s, n) => s + n, 0);
      return {
        member,
        perDay,
        total,
        rangesByDay: dates.map((date) => {
          const hours = (map[date] ?? []).slice().sort((a, b) => a - b);
          return { date, hours, text: hoursToRanges(hours).join(", ") || "—" };
        }),
      };
    })
    .sort((a, b) => b.total - a.total);
}

export function freeHoursInRange(map: AvailabilityMap, dates: string[]): number {
  return dates.reduce((sum, d) => sum + (map[d]?.length ?? 0), 0);
}

export function freeHoursFor(members: Member, availability: AvailabilityMap, days = 7): number {
  return freeHoursInRange(availability, nextDates(days));
}

export function teamTotals(rows: FreeSlotRow[]) {
  const total = rows.reduce((s, r) => s + r.total, 0);
  const most = rows[0];
  const least = rows[rows.length - 1];
  const unset = rows.filter((r) => r.total === 0).length;
  return { total, most, least, unset };
}
