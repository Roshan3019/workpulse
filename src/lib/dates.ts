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

/* -------------------------------------------------------------------------- */
/* Task timing — relative, so deadlines read as "in 3 days" not a bare date    */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM-DD` + `HH:MM` → local Date. Missing time means end of day. */
export function dueDateOf(dateISO: string, time?: string | null): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  if (time && /^\d{2}:\d{2}$/.test(time)) {
    const [hh, mm] = time.split(":").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, hh, mm, 0, 0);
  }
  return new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 0, 0);
}

export function dueLabel(dateISO: string, time?: string | null): string {
  const d = dueDateOf(dateISO, time);
  const datePart = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!time) return datePart;
  return `${datePart}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * Human countdown: "Overdue by 2 days", "Due today, 5:00 PM", "In 3 days".
 * Computed against the clock at render time, so it is always current.
 */
export function countdownLabel(dateISO: string, time?: string | null, now = new Date()): string {
  const due = dueDateOf(dateISO, time);
  const ms = due.getTime() - now.getTime();
  const dayMs = 86_400_000;

  if (ms < 0) {
    const overdueDays = Math.floor(-ms / dayMs);
    if (overdueDays === 0) return "Overdue";
    return `Overdue by ${overdueDays} ${overdueDays === 1 ? "day" : "days"}`;
  }

  const sameDay = toISODate(now) === dateISO;
  const tomorrow = toISODate(new Date(now.getTime() + dayMs)) === dateISO;

  if (sameDay) {
    const h = Math.max(1, Math.round(ms / 3_600_000));
    if (ms < 3_600_000) return `Due in ${Math.max(1, Math.round(ms / 60_000))} min`;
    return `Due today · ${h}h left`;
  }
  if (tomorrow) return "Due tomorrow";

  const days = Math.round(ms / dayMs);
  if (days <= 14) return `In ${days} days`;
  return `In ${Math.round(days / 7)} weeks`;
}

/** Hours between start date and due date — the "float" a task has. */
export function timingWindowDays(startISO: string | null, dueISO: string | null): number | null {
  if (!startISO || !dueISO) return null;
  const a = fromISODate(startISO).getTime();
  const b = fromISODate(dueISO).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export const TIME_PRESETS = [
  { label: "Morning · 9 AM", value: "09:00" },
  { label: "Noon · 12 PM", value: "12:00" },
  { label: "End of day · 6 PM", value: "18:00" },
] as const;

/* -------------------------------------------------------------------------- */
/* "Now" in the user's timezone, not the server's                              */
/* -------------------------------------------------------------------------- */

/**
 * Today's date (YYYY-MM-DD) as the *user* experiences it.
 *
 * On a server (Vercel runs UTC) `new Date()` can already be "tomorrow" while
 * the user is still in yesterday evening — or still "yesterday" for a user in
 * New Zealand. Pages therefore pass the browser's timezone (the `wp_tz`
 * cookie, set by `TimeZoneSync`) and every date window is computed against it.
 * Falls back to the server clock when the cookie is absent.
 */
export function todayISOIn(tz?: string | null): string {
  if (!tz) return todayISO();
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return todayISO();
  }
}

/** `nextDates`, anchored to the user's local today. */
export function nextDatesIn(count: number, tz?: string | null): string[] {
  return nextDates(count, todayISOIn(tz));
}

/** The `wp_tz` cookie name used by <TimeZoneSync /> and the server pages. */
export const TZ_COOKIE = "wp_tz";
