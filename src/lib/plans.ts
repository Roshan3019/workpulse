/**
 * A member's working plan for a task — the hours they will spend on it.
 *
 * The rules the client asked for, and where they live:
 *
 *   • A plan is ONE continuous block: 2pm to 6pm, not eight separate cells.
 *     So the editor merges touching blocks and the grid paints one long bar.
 *   • Planning hours *is* saying you're busy then. A block in a working hour
 *     therefore shows as busy on the team-slot row and carries the task name,
 *     which is the whole point of the feature.
 *   • Two tasks in the same hour is a real situation (a shared job, or a
 *     mistake) — the block says "Landing page +1" and the tooltip lists both.
 *
 * Everything here is pure so the same rules can be tested without a browser;
 * the store, the server actions and the grid all call these.
 */
import { HOURS } from "./dates";
import type {
  AvailabilityStates,
  PlannedBlock,
  SlotState,
  TaskPlan,
  TaskStatus,
} from "./types";

/** The working window every grid in the app paints: 8am to 7pm. */
export const PLAN_FIRST_HOUR = 8;
export const PLAN_LAST_HOUR = 19;

export const PLAN_HOURS: number[] = HOURS.filter(
  (h) => h >= PLAN_FIRST_HOUR && h <= PLAN_LAST_HOUR,
);

export type PlanState = "free" | "busy" | "unassigned" | "planned" | "planned-busy";

/** A block in the editor before it has an id (or read back from the database). */
export interface PlanDraft {
  id?: string;
  date: string;
  startHour: number;
  endHour: number;
  minutes: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export const blockHours = (block: { startHour: number; endHour: number }): number[] => {
  const out: number[] = [];
  for (let h = block.startHour; h < block.endHour; h += 1) out.push(h);
  return out;
};

export const blockLength = (block: { startHour: number; endHour: number }) =>
  Math.max(0, block.endHour - block.startHour);

/** "2p–6p", "9a–11a", "12p–1p". */
export function blockLabel(hour: (h: number) => string, block: { startHour: number; endHour: number }): string {
  return `${hour(block.startHour)}–${hour(block.endHour)}`;
}

/**
 * Sort, clamp to the working window, drop empties, and merge anything that
 * touches. Merging is what keeps "2–4 then 4–6" one block instead of two
 * adjacent ones the grid would have to hide a seam in.
 */
export function normaliseBlocks(blocks: PlanDraft[]): PlanDraft[] {
  const clean = blocks
    .map((b) => ({
      ...b,
      startHour: clamp(Math.round(b.startHour), 0, 23),
      endHour: clamp(Math.round(b.endHour), 1, 24),
    }))
    .filter((b) => b.endHour > b.startHour)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour);

  const merged: PlanDraft[] = [];
  for (const block of clean) {
    const last = merged[merged.length - 1];
    if (last && last.date === block.date && block.startHour <= last.endHour) {
      last.endHour = Math.max(last.endHour, block.endHour);
      last.minutes += block.minutes;
      // Merging keeps the earliest id so an existing row is updated, not duplicated.
      if (!last.id) last.id = block.id;
      continue;
    }
    merged.push({ ...block });
  }
  return merged;
}

/** Hours covered by any block on a date. */
export function plannedHoursOn(blocks: PlanDraft[], date: string): Set<number> {
  const out = new Set<number>();
  for (const block of blocks) {
    if (block.date !== date) continue;
    for (const hour of blockHours(block)) out.add(hour);
  }
  return out;
}

/**
 * How one cell should read once plans are laid over the availability grid.
 *
 * `free` on the grid is the one state a plan is allowed to overrule: the client
 * chose "planning hours marks you busy", so a planned hour is never shown as
 * free. An hour the member marked busy by hand stays busy, and a plan on top of
 * it is `planned-busy` — the same bar, with the tooltip saying both.
 */
export function planCellState(
  base: SlotState | undefined,
  planned: number,
): PlanState {
  if (planned > 0) return base === "busy" ? "planned-busy" : "planned";
  return base ?? "unassigned";
}

/** Blocks on a date, in order, with the stacked task names for the label. */
export interface DayBlock {
  date: string;
  startHour: number;
  endHour: number;
  minutes: number;
  plans: PlannedBlock[];
  /** One name, or "Landing page +1" when two tasks share the block. */
  label: string;
  /** Every plan's task title, for the tooltip. */
  titles: string[];
  done: boolean;
  /** True when the block lands on hours the member had marked free. */
  overFree: boolean;
}

const isDone = (status: TaskStatus) => status === "done";

/**
 * Lay plans over a day so the grid can paint one bar per continuous block.
 *
 * Two plans that overlap but do not share both ends (2–5 and 4–7) are split at
 * the boundary into 2–4, 4–5 and 5–7, so a cell can never have two answers and
 * the overlap is visible as its own segment. Blocks made of the same set of
 * plans are then merged, which is what keeps 2–6 as a single 4-hour bar.
 */
export function dayBlocks(
  plans: PlannedBlock[],
  date: string,
  availability?: Record<number, SlotState>,
): DayBlock[] {
  const onDay = plans
    .filter((p) => p.date === date)
    .sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);
  if (!onDay.length) return [];

  const edges = [...new Set(onDay.flatMap((p) => [p.startHour, p.endHour]))].sort((a, b) => a - b);
  const segments: { startHour: number; endHour: number; plans: PlannedBlock[] }[] = [];

  for (let i = 0; i < edges.length - 1; i += 1) {
    const start = edges[i];
    const end = edges[i + 1];
    const covering = onDay.filter((p) => p.startHour <= start && p.endHour >= end);
    if (!covering.length) continue;
    segments.push({ startHour: start, endHour: end, plans: covering });
  }

  const merged: { startHour: number; endHour: number; plans: PlannedBlock[] }[] = [];
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
    const minutes = segment.plans.reduce((sum, p) => sum + Number(p.minutes || 0), 0);
    const overFree = blockHours(segment).some(
      (hour) => (availability?.[hour] ?? "unassigned") === "free",
    );
    return {
      date,
      startHour: segment.startHour,
      endHour: segment.endHour,
      minutes,
      plans: segment.plans,
      label: titles.length > 1 ? `${titles[0]} +${titles.length - 1}` : titles[0] ?? "Task",
      titles,
      done: segment.plans.every((p) => isDone(p.taskStatus)),
      overFree,
    };
  });
}

/**
 * A day as the grid wants it: the availability states, with every planned hour
 * switched to busy. This is the "planning hours marks you busy" rule applied at
 * read time, so one function decides it for the dashboard, the member's own
 * calendar and the admin's read-only view.
 */
export function mergePlansIntoStates(
  availability: Record<number, SlotState> | undefined,
  blocks: DayBlock[],
): Record<number, PlanState> {
  const out: Record<number, PlanState> = {};
  for (const [hour, state] of Object.entries(availability ?? {})) {
    out[Number(hour)] = state;
  }
  for (const block of blocks) {
    for (const hour of blockHours(block)) {
      out[hour] = (availability?.[hour] ?? "unassigned") === "busy" ? "planned-busy" : "planned";
    }
  }
  return out;
}

/** Total planned minutes per date, for the member's own summary. */
export function plannedMinutes(plans: { date: string; minutes: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const plan of plans) out[plan.date] = (out[plan.date] ?? 0) + Number(plan.minutes || 0);
  return out;
}

/** "4h planned", "1h 30m planned". */
export function minutesLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * The availability rows a plan implies: any planned hour that is not already
 * recorded as busy becomes busy. Returns only the days that change, so saving a
 * plan never rewrites a day the member left alone.
 */
export function busyStatesForPlans(
  plans: { date: string; startHour: number; endHour: number }[],
  existing: AvailabilityStates,
): Record<string, Record<number, SlotState>> {
  const out: Record<string, Record<number, SlotState>> = {};
  for (const plan of plans) {
    const day = { ...(existing[plan.date] ?? {}) };
    let changed = false;
    for (const hour of blockHours(plan)) {
      if (day[hour] !== "busy") {
        day[hour] = "busy";
        changed = true;
      }
    }
    if (changed) out[plan.date] = day;
  }
  return out;
}

/** Guard used by the server action: is this a block a member may save? */
export function validatePlanBlock(block: {
  date: string;
  startHour: number;
  endHour: number;
  minutes: number;
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(block.date)) return "Pick a date for this block.";
  if (!Number.isInteger(block.startHour) || !Number.isInteger(block.endHour)) {
    return "Pick whole hours.";
  }
  if (block.endHour <= block.startHour) return "A block has to end after it starts.";
  if (block.startHour < 0 || block.endHour > 24) return "That block is outside the day.";
  if (!Number.isFinite(block.minutes) || block.minutes < 0) return "Hours must be positive.";
  if (block.minutes > blockLength(block) * 60) {
    return "You can't spend more time in a block than the block is long.";
  }
  return null;
}

/** Convenience for sort order in lists. */
export const byStart = (a: TaskPlan, b: TaskPlan) =>
  a.date.localeCompare(b.date) || a.startHour - b.startHour;
