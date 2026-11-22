/**
 * Date / hour helpers. All dates are handled as `YYYY-MM-DD` strings in the
 * user's local calendar day to avoid timezone drift between server and client.
 */

export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 22; // exclusive

export const HOURS: number[] = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR },
  (_, i) => DAY_START_HOUR + i,
);

export const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

export function hourLabel(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` into a *local* midnight Date (not UTC). */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function nextDates(count: number, start = todayISO()): string[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export function weekdayOf(iso: string): string {
  return WEEKDAYS[fromISODate(iso).getDay()];
}

export function shortDate(iso: string): string {
  return fromISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dayLabel(iso: string): string {
  return `${weekdayOf(iso)} ${fromISODate(iso).getDate()}`;
}

export function isWeekend(iso: string): boolean {
  const day = fromISODate(iso).getDay();
  return day === 0 || day === 6;
}

export function isPast(iso: string): boolean {
  return iso < todayISO();
}

/** Format the next 14 days as a compact range for headers. */
export function rangeLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const first = dates[0];
  const last = dates[dates.length - 1];
  return `${shortDate(first)} – ${shortDate(last)}`;
}

/**
 * Collapse a set of hours into human-readable ranges, e.g. [9,10,11,13]
 * -> "9a–12p, 1p–2p".
 */
export function hoursToRanges(hours: number[]): string[] {
  if (!hours?.length) return [];
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i];
    if (h === prev + 1) {
      prev = h;
      continue;
    }
    ranges.push(`${hourLabel(start)}–${hourLabel(prev + 1)}`);
    start = h;
    prev = h;
  }
  ranges.push(`${hourLabel(start)}–${hourLabel(prev + 1)}`);
  return ranges;
}

export function rangesText(hours: number[]): string {
  const r = hoursToRanges(hours);
  return r.length ? r.join(", ") : "—";
}

export const PRESETS = {
  standard: [9, 10, 11, 12, 13, 14, 15, 16],
  mornings: [6, 7, 8, 9, 10, 11, 12],
  evenings: [17, 18, 19, 20, 21],
} as const;
