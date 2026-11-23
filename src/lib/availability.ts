import type { AvailabilityMap, AvailabilityStates, SlotState } from "./types";

/**
 * The two availability shapes, and the conversions between them.
 *
 * This is the only module that should know about both. Everywhere else should
 * speak in `AvailabilityStates` (tri-state). The legacy `AvailabilityMap`
 * (date -> free hours) survives only because a few call sites — the workload
 * calculation and the memory store — have not moved yet, and because the
 * database still mirrors `hours` for the same reason.
 */

/** The three things a cell can be, from the user's point of view. */
export type CellState = SlotState | "unassigned";

export const HOURS_PER_DAY = 24;

/** legacy hours[] -> tri-state (present hour = free) */
export function statesFromHours(hours: readonly number[] | undefined | null): Record<number, SlotState> {
  const out: Record<number, SlotState> = {};
  for (const h of hours ?? []) out[Number(h)] = "free";
  return out;
}

/** tri-state -> legacy hours[] (only the free ones) */
export function hoursFromStates(states: Record<number, SlotState> | undefined | null): number[] {
  return Object.entries(states ?? {})
    .filter(([, v]) => v === "free")
    .map(([h]) => Number(h))
    .sort((a, b) => a - b);
}

/** What is this cell? Missing key means the person has not filled it in. */
export function cellState(
  states: Record<number, SlotState> | undefined,
  hour: number,
): CellState {
  return states?.[hour] ?? "unassigned";
}

/** Flip a single hour to `next`; passing the same value clears it to unassigned. */
export function setCell(
  states: Record<number, SlotState>,
  hour: number,
  next: SlotState,
): Record<number, SlotState> {
  const out = { ...states };
  if (out[hour] === next) delete out[hour];
  else out[hour] = next;
  return out;
}

/** Paint a run of hours, e.g. dragging across a row. */
export function setRange(
  states: Record<number, SlotState>,
  hours: number[],
  next: SlotState,
): Record<number, SlotState> {
  const out = { ...states };
  for (const h of hours) out[h] = next;
  return out;
}

/** Whole-day conversion for a map of dates. */
export function statesFromLegacyMap(map: AvailabilityMap): AvailabilityStates {
  const out: AvailabilityStates = {};
  for (const [date, hours] of Object.entries(map)) {
    // Days with no hours carry no information — don't create an empty row.
    if (!hours?.length) continue;
    out[date] = statesFromHours(hours);
  }
  return out;
}

/**
 * Counts for the summary line above the grid.
 *
 * `unassigned` is deliberately reported rather than folded into busy: "you
 * have not filled in Thursday" is a different message from "you're busy on
 * Thursday", and the whole point of the third state is to tell them apart.
 */
export function countStates(states: Record<number, SlotState>): {
  free: number;
  busy: number;
  unassigned: number;
} {
  let free = 0;
  let busy = 0;
  for (const v of Object.values(states)) {
    if (v === "free") free++;
    else if (v === "busy") busy++;
  }
  return { free, busy, unassigned: HOURS_PER_DAY - free - busy };
}

/** Totals across several days — used by the admin overview. */
export function countStatesAcross(days: Record<number, SlotState>[]): {
  free: number;
  busy: number;
  unassigned: number;
} {
  return days.reduce<{ free: number; busy: number; unassigned: number }>(
    (acc, day) => {
      const c = countStates(day);
      return {
        free: acc.free + c.free,
        busy: acc.busy + c.busy,
        unassigned: acc.unassigned + c.unassigned,
      };
    },
    { free: 0, busy: 0, unassigned: 0 },
  );
}

/**
 * Normalise a value that came out of the database.
 *
 * `states` is `jsonb` with string keys; anything that is not 'free'/'busy' is
 * dropped rather than trusted, so a hand-edited row cannot break rendering.
 */
export function normaliseStates(raw: unknown): Record<number, SlotState> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<number, SlotState> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const hour = Number(k);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    if (v === "free" || v === "busy") out[hour] = v;
  }
  return out;
}
