"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Modal";
import { bulkSaveAvailabilityAction } from "@/lib/actions/availability";
import { HOURS, PRESETS, hourLabel, shortDate, todayISO, todayISOIn, weekdayOf, fromISODate, rangesText } from "@/lib/dates";
import type { AvailabilityMap } from "@/lib/types";

type Mode = "edit" | "read";

/** Workday window — showing 6a–10p across 7 days made the grid feel like a spreadsheet. */
const DAY_START = 8; // 8am
const DAY_END = 20; // exclusive → last slot is 7p

const VISIBLE_HOURS = HOURS.filter((h) => h >= DAY_START && h < DAY_END);

/** Group hours into 3 blocks so the grid reads as Morning / Afternoon / Evening. */
const BLOCKS = [
  { label: "Morning", hint: "8a – 12p", hours: [8, 9, 10, 11] },
  { label: "Afternoon", hint: "12p – 5p", hours: [12, 13, 14, 15, 16] },
  { label: "Evening", hint: "5p – 8p", hours: [17, 18, 19] },
] as const;

export function AvailabilityGrid({
  dates,
  initial,
  mode,
  emptyHint,
  today: serverToday,
}: {
  dates: string[];
  initial: AvailabilityMap;
  mode: Mode;
  emptyHint?: string;
  /** The user's local today, computed on the server from the wp_tz cookie. */
  today?: string;
}) {
  const router = useRouter();
  const editable = mode === "edit";
  const [map, setMap] = useState<AvailabilityMap>(() => ({ ...initial }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [brush, setBrush] = useState<"free" | "busy">("free");

  // Date helpers below compare against "today". Recompute it from the browser
  // clock so a tab left open past midnight ticks over with the real date.
  const [today, setToday] = useState(serverToday ?? todayISO());
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tick = () => setToday(todayISOIn(tz));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const dragging = useRef(false);
  const painted = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMap({ ...initial });
    setDirty(false);
  }, [initial]);

  /** next 7 days from today, so the page is about *this* week. */
  const days = useMemo(() => dates.slice(0, 7), [dates]);

  const totalFor = useCallback((date: string) => (map[date] ?? []).length, [map]);
  const weekTotal = useMemo(() => days.reduce((sum, d) => sum + (map[d]?.length ?? 0), 0), [days, map]);

  const paintCell = useCallback((el: HTMLElement, free: boolean) => {
    const date = el.dataset.date;
    const hour = Number(el.dataset.hour);
    if (!date || Number.isNaN(hour)) return;
    const key = `${date}:${hour}`;
    if (painted.current.has(key)) return;
    painted.current.add(key);

    setMap((prev) => {
      const current = new Set(prev[date] ?? []);
      if (free) current.add(hour);
      else current.delete(hour);
      const nextHours = [...current].sort((a, b) => a - b);
      const next = { ...prev };
      if (nextHours.length) next[date] = nextHours;
      else delete next[date];
      return next;
    });
    setDirty(true);
  }, []);

  useEffect(() => {
    if (!editable) return;
    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const cell = target?.closest<HTMLElement>(".cell");
      if (cell && cell.dataset.readonly !== "true") {
        event.preventDefault();
        paintCell(cell, brush === "free");
      }
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      painted.current.clear();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [editable, paintCell, brush]);

  function onCellPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!editable) return;
    event.preventDefault();
    const el = event.currentTarget;
    // Starting on green erases, starting on grey adds — same as a paint tool.
    const free = el.dataset.free !== "true";
    painted.current.clear();
    dragging.current = true;
    paintCell(el, free);
  }

  function setDay(date: string, hours: readonly number[]) {
    setMap((prev) => {
      const next = { ...prev };
      if (hours.length) next[date] = [...hours];
      else delete next[date];
      return next;
    });
    setDirty(true);
    setMessage(null);
  }

  /** Apply a preset to every weekday (Mon–Fri) — the shortcut people actually want. */
  function applyToWeekdays(hours: readonly number[]) {
    setMap((prev) => {
      const next = { ...prev };
      for (const date of days) {
        const dow = fromISODate(date).getDay();
        if (dow >= 1 && dow <= 5) next[date] = [...hours];
      }
      return next;
    });
    setDirty(true);
    setMessage({ tone: "success", text: "Applied to Monday–Friday. Don't forget to save." });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const entries = days.map((date) => ({ date, hours: map[date] ?? [] }));
    const result = await bulkSaveAvailabilityAction(entries);
    setSaving(false);
    if (result.error) {
      setMessage({ tone: "error", text: result.error });
    } else {
      setMessage({ tone: "success", text: "Availability saved." });
      setDirty(false);
      router.refresh();
    }
  }

  const isEmptyWeek = weekTotal === 0;

  return (
    <div>
      {/* ---------------- toolbar: one row, obvious ---------------- */}
      {editable ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="mr-1 inline-flex rounded-full border border-line-2 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setBrush("free")}
              aria-pressed={brush === "free"}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold transition ${
                brush === "free" ? "bg-ok-soft text-ok-dark" : "text-muted hover:text-ink"
              }`}
            >
              ✓ Mark free
            </button>
            <button
              type="button"
              onClick={() => setBrush("busy")}
              aria-pressed={brush === "busy"}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold transition ${
                brush === "busy" ? "bg-[#eef1f8] text-ink-2" : "text-muted hover:text-ink"
              }`}
            >
              ✕ Mark busy
            </button>
          </div>

          <select
            aria-label="Quick fill"
            className="rounded-full border border-line-2 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 outline-none"
            defaultValue=""
            onChange={(event) => {
              const key = event.target.value as keyof typeof PRESETS | "";
              if (!key) return;
              applyToWeekdays(PRESETS[key]);
              event.currentTarget.value = "";
            }}
          >
            <option value="" disabled>
              Quick fill Mon–Fri…
            </option>
            <option value="standard">Standard 9am–5pm</option>
            <option value="mornings">Mornings 8am–1pm</option>
            <option value="evenings">Evenings 5pm–8pm</option>
          </select>

          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="btn-primary btn-sm ml-auto disabled:opacity-50"
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      ) : null}

      {/* ---------------- legend ---------------- */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] font-semibold text-muted">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 rounded-[4px] bg-ok" /> Free
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 rounded-[4px] border border-[#e3e6f2] bg-[#eef1f8]" /> Busy
        </span>
        {editable ? <span className="text-faint">Drag across cells to paint. Start on green to erase.</span> : null}
        {editable && dirty ? (
          <span className="ml-auto flex items-center gap-1.5 font-bold text-warn-dark">
            <i className="inline-block h-2 w-2 rounded-full bg-warn" /> Unsaved
          </span>
        ) : (
          <span className="ml-auto text-ink-2">
            <b>{weekTotal}h</b> free this week
          </span>
        )}
      </div>

      {isEmptyWeek && editable ? (
        <div className="mb-3 rounded-xl border border-brand-line bg-brand-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed font-semibold text-brand-dark">
          Nothing marked yet. Pick a quick fill above, or drag across the days you&apos;re free.
        </div>
      ) : null}

      {/* ---------------- the grid: 7 days, 3 blocks, 12 hours ---------------- */}
      <div className="scroll-x -mx-1 px-1">
        <div className="min-w-[560px]">
          {/* block headers */}
          <div
            className="mb-1.5 grid items-end gap-1"
            style={{ gridTemplateColumns: `58px repeat(${BLOCKS.length}, minmax(0, 1fr))` }}
          >
            <div />
            {BLOCKS.map((block) => (
              <div key={block.label} className="text-center">
                <div className="text-[11px] font-extrabold tracking-[.06em] text-ink-2 uppercase">{block.label}</div>
                <div className="text-[10px] font-semibold text-faint">{block.hint}</div>
              </div>
            ))}
          </div>

          {days.map((date, index) => {
            const freeSet = new Set(map[date] ?? []);
            const isToday = date === today;
            const count = freeSet.size;
            return (
              <div
                key={date}
                className="grid items-center gap-1 border-t border-[#f0f1f7] py-1.5 first:border-t-0"
                style={{ gridTemplateColumns: `58px repeat(${BLOCKS.length}, minmax(0, 1fr))` }}
              >
                <div className="pr-1">
                  <div className={`text-[11px] font-extrabold tracking-wide uppercase ${isToday ? "text-brand" : "text-ink-2"}`}>
                    {weekdayOf(date)}
                  </div>
                  <div className={`text-[15px] leading-tight font-extrabold ${isToday ? "text-brand" : "text-ink"}`}>
                    {fromISODate(date).getDate()}
                  </div>
                  <div className={`text-[10px] font-bold ${count ? "text-ok-dark" : "text-faint"}`}>
                    {count ? `${count}h` : "—"}
                  </div>
                </div>

                {BLOCKS.map((block) => (
                  <div key={block.label} className="flex gap-1">
                    {block.hours.map((hour) => {
                      const free = freeSet.has(hour);
                      return (
                        <div
                          key={hour}
                          className="cell flex-1"
                          data-date={date}
                          data-hour={hour}
                          data-free={free ? "true" : "false"}
                          data-readonly={editable ? "false" : "true"}
                          data-selected={isToday ? "true" : "false"}
                          onPointerDown={onCellPointerDown}
                          role={editable ? "button" : undefined}
                          aria-label={`${weekdayOf(date)} ${shortDate(date)} ${hourLabel(hour)} ${free ? "free" : "busy"}`}
                          tabIndex={editable ? 0 : -1}
                          onKeyDown={(event) => {
                            if (!editable) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              painted.current.clear();
                              paintCell(event.currentTarget, !freeSet.has(hour));
                            }
                          }}
                          title={`${hourLabel(hour)}–${hourLabel(hour + 1)}`}
                        >
                          <span className="sr-only">{hourLabel(hour)}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------------- per-day chips: the plain-English summary ---------------- */}
      <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {days.map((date) => {
          const hours = (map[date] ?? []).slice().sort((a, b) => a - b);
          const isToday = date === today;
          return (
            <div
              key={date}
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[12.5px] ${
                hours.length ? "border-[#d9f2e6] bg-ok-soft/60" : "border-line bg-[#fafaff]"
              }`}
            >
              <span className="font-bold text-ink-2">
                {weekdayOf(date)} {fromISODate(date).getDate()}
                {isToday ? <span className="ml-1.5 text-[10.5px] font-extrabold text-brand uppercase">today</span> : null}
              </span>
              <span className={`text-right font-semibold ${hours.length ? "text-[#065f46]" : "text-faint"}`}>
                {hours.length ? rangesText(hours) : "busy"}
              </span>
              {editable ? (
                <button
                  type="button"
                  onClick={() => setDay(date, [])}
                  disabled={!hours.length}
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-faint transition hover:bg-white hover:text-ink disabled:opacity-0"
                  aria-label={`Clear ${weekdayOf(date)}`}
                >
                  clear
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {!editable && emptyHint ? <p className="mt-3 text-[12px] text-faint">{emptyHint}</p> : null}

      {/* footer totals */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        <span>
          This week: <b className="text-ink-2">{weekTotal}h free</b>
        </span>
        <span className="text-faint">·</span>
        <span>{days.filter((d) => (map[d] ?? []).length).length} of 7 days with hours</span>
      </div>

      {message ? (
        <div className="mt-3">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}
    </div>
  );
}
