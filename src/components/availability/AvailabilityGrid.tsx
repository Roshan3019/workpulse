"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Modal";
import { bulkSaveAvailabilityStatesAction } from "@/lib/actions/availability";
import {
  cellState,
  countStates,
  hoursFromStates,
  setCell,
  statesFromHours,
  type CellState,
} from "@/lib/availability";
import { HOURS, PRESETS, hourLabel, shortDate, todayISO, todayISOIn, weekdayOf, fromISODate, rangesText } from "@/lib/dates";
import type { AvailabilityStates, SlotState } from "@/lib/types";

type Mode = "edit" | "read";

/** Workday window — showing 6a–10p across 7 days made the grid feel like a spreadsheet. */
const DAY_START = 8; // 8am
const DAY_END = 20; // exclusive → last slot is 7p

const VISIBLE_HOURS = HOURS.filter((h) => h >= DAY_START && h < DAY_END);

/** Width of the weekday/date gutter, shared by the ruler and every row. */
const DAY_GUTTER = "56px";

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
  initial: AvailabilityStates;
  mode: Mode;
  emptyHint?: string;
  /** The user's local today, computed on the server from the wp_tz cookie. */
  today?: string;
}) {
  const router = useRouter();
  const editable = mode === "edit";
  const [map, setMap] = useState<AvailabilityStates>(() => ({ ...initial }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  /*
   * The paint tool. `unassigned` is a first-class brush: the client asked for
   * three buttons, so erasing is a deliberate action rather than a hidden
   * side effect of starting a drag on a green cell.
   */
  const [brush, setBrush] = useState<CellState>("free");

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

  const totalFor = useCallback((date: string) => countStates(map[date] ?? {}).free, [map]);
  const weekTotal = useMemo(
    () => days.reduce((sum, d) => sum + countStates(map[d] ?? {}).free, 0),
    [days, map],
  );
  const weekBusy = useMemo(
    () => days.reduce((sum, d) => sum + countStates(map[d] ?? {}).busy, 0),
    [days, map],
  );
  const weekUnassigned = useMemo(
    () => days.reduce((sum, d) => sum + countStates(map[d] ?? {}).unassigned, 0),
    [days, map],
  );

  const paintCell = useCallback((el: HTMLElement, next: CellState) => {
    const date = el.dataset.date;
    const hour = Number(el.dataset.hour);
    if (!date || Number.isNaN(hour)) return;
    const key = `${date}:${hour}`;
    if (painted.current.has(key)) return;
    painted.current.add(key);

    setMap((prev) => {
      const day = { ...(prev[date] ?? {}) };
      if (next === "unassigned") delete day[hour];
      else day[hour] = next as SlotState;
      const out = { ...prev };
      if (Object.keys(day).length) out[date] = day;
      else delete out[date];
      return out;
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
        paintCell(cell, brush);
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
    // The brush decides what happens — clicking never silently reverses it.
    painted.current.clear();
    dragging.current = true;
    paintCell(event.currentTarget, brush);
  }

  /** Paint a whole day with the current brush (or clear it). */
  function setDay(date: string, next: CellState) {
    setMap((prev) => {
      const out = { ...prev };
      if (next === "unassigned") {
        delete out[date];
        return out;
      }
      const day: Record<number, SlotState> = {};
      for (const hour of VISIBLE_HOURS) day[hour] = next as SlotState;
      out[date] = day;
      return out;
    });
    setDirty(true);
    setMessage(null);
  }

  /** Apply a preset to every weekday (Mon–Fri) — the shortcut people actually want. */
  function applyToWeekdays(hours: readonly number[]) {
    setMap((prev) => {
      const out = { ...prev };
      for (const date of days) {
        const dow = fromISODate(date).getDay();
        if (dow >= 1 && dow <= 5) out[date] = statesFromHours(hours);
      }
      return out;
    });
    setDirty(true);
    setMessage({ tone: "success", text: "Applied to Monday–Friday. Don't forget to save." });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const entries = days.map((date) => ({ date, states: map[date] ?? {} }));
    const result = await bulkSaveAvailabilityStatesAction(entries);
    setSaving(false);
    if (result.error) {
      setMessage({ tone: "error", text: result.error });
    } else {
      setMessage({ tone: "success", text: "Availability saved." });
      setDirty(false);
      router.refresh();
    }
  }

  const isEmptyWeek = weekTotal === 0 && weekBusy === 0;

  return (
    <div>
      {/* ---------------- toolbar: one row, obvious ---------------- */}
      {editable ? (
        <div className="mb-4 grid gap-2 sm:grid-cols-[auto_auto_1fr] sm:items-center">
          {/*
            Three buttons, one per state — the client asked for exactly this.
            Green = free, light red = busy, grey = not filled in. The selected
            one is filled with its own colour; the others stay quiet.
          */}
          <div
            className="flex items-center gap-1 rounded-xl border border-line-2 bg-white p-1"
            role="group"
            aria-label="What to paint"
          >
            {([
              { value: "free", label: "Free", dot: "bg-ok", on: "bg-ok-soft text-ok-dark ring-1 ring-ok/40", ring: "ring-ok/40" },
              { value: "busy", label: "Busy", dot: "bg-bad/70", on: "bg-bad-soft text-[#991b1b] ring-1 ring-bad/30", ring: "ring-bad/30" },
              { value: "unassigned", label: "Unassigned", dot: "bg-line-2", on: "bg-[#f8f6f3] text-ink-2 ring-1 ring-line-2", ring: "ring-line-2" },
            ] as const).map((option) => {
              const active = brush === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setBrush(option.value)}
                  aria-pressed={active}
                  title={`Paint ${option.label.toLowerCase()}`}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-150 ${
                    active ? option.on : "text-muted hover:bg-[#f8f6f3] hover:text-ink-2"
                  }`}
                >
                  <i className={`h-2.5 w-2.5 rounded-[3px] ${option.dot}`} aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>

          <select
            aria-label="Quick fill"
            className="h-9 w-full rounded-full border border-line-2 bg-white px-3 text-[12.5px] font-semibold text-ink-2 outline-none sm:w-auto"
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
            className="btn-primary btn-sm w-full disabled:opacity-50 sm:w-auto sm:justify-self-end"
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      ) : null}

      {/* ---------------- legend ---------------- */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] font-medium text-muted">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-ok" aria-hidden="true" /> Free
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-bad/55" aria-hidden="true" /> Busy
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-[3px] border border-line-2 bg-[#f4f5fa]" aria-hidden="true" /> Unassigned
        </span>
        {editable ? <span className="text-faint">Drag to paint.</span> : null}
        {editable && dirty ? (
          <span className="ml-auto flex items-center gap-1.5 font-semibold text-warn-dark">
            <i className="inline-block h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" /> Unsaved
          </span>
        ) : (
          <span className="ml-auto tabular-nums text-ink-2">
            <b className="font-semibold">{weekTotal}h</b> free this week
          </span>
        )}
      </div>

      {/*
        The hint keeps its place once the week stops being empty.
        It used to be removed the moment the first cell was painted, which
        pulled the whole grid up by the height of the banner — the grid jumped
        exactly when the client was aiming at it. Now the box stays in the
        layout and only its ink disappears (visibility, not display), so the
        first painted cell never moves a row under the pointer.
      */}
      {editable ? (
        <div
          aria-hidden={!isEmptyWeek}
          className={`mb-3 rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed font-semibold text-brand-dark ${
            isEmptyWeek
              ? "border-brand-line bg-brand-soft"
              : "invisible border-transparent bg-transparent"
          }`}
        >
          Pick <b>Free</b>, <b>Busy</b> or <b>Unassigned</b> above, then drag across the hours.
        </div>
      ) : null}

      {/* ---------------- the grid: 7 days, 12 hours ---------------- */}
      {/*
        One grid template for the captions, the hour ruler and every row, so a
        label can never drift off its column. The columns are `1fr`, not 44px:
        the grid fills whatever width the card has (which is what the client
        asked for on the admin page, where the old fixed 628px left half the
        card blank) and only falls back to a horizontal scroll — via the
        628px floor — on a phone.
      */}
      <div className="scroll-x -mx-1 px-1">
        <div className="min-w-[628px]" style={{ display: "grid", gridTemplateColumns: `${DAY_GUTTER} repeat(${VISIBLE_HOURS.length}, minmax(0, 1fr))` }}>
          {/* group captions: each spans exactly the hours it names */}
          <div />
          {BLOCKS.map((block) => (
            <div
              key={block.label}
              className="text-center text-[10.5px] font-medium tracking-[.06em] text-faint uppercase"
              style={{ gridColumn: `span ${block.hours.length}` }}
            >
              {block.label}
            </div>
          ))}

          {/* hour labels, one per column */}
          <div />
          {VISIBLE_HOURS.map((hour) => (
            <div
              key={hour}
              className="border-b border-line pb-1.5 text-center text-[10px] font-medium tabular-nums text-faint"
            >
              {hourLabel(hour)}
            </div>
          ))}

          {days.map((date) => {
            const counts = countStates(map[date] ?? {});
            const isToday = date === today;
            const count = counts.free;
            const busyCount = counts.busy;
            return (
              <Fragment key={date}>
                <div className="flex items-center pr-1">
                  <div>
                    <div
                      className={`text-[10.5px] font-semibold tracking-[.04em] uppercase ${
                        isToday ? "text-brand" : "text-faint"
                      }`}
                    >
                      {weekdayOf(date)}
                    </div>
                    <div
                      className={`text-[14px] leading-tight font-semibold tabular-nums ${
                        isToday ? "text-brand" : "text-ink"
                      }`}
                    >
                      {fromISODate(date).getDate()}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] font-semibold">
                      {count ? <span className="tabular-nums text-[#3f8f63]">{count}h</span> : null}
                      {busyCount ? <span className="tabular-nums text-[#b91c1c]">{busyCount}h</span> : null}
                      {!count && !busyCount ? <span className="text-faint">—</span> : null}
                    </div>
                  </div>
                </div>

                {VISIBLE_HOURS.map((hour) => {
                  const state = cellState(map[date], hour);
                  const label = state === "unassigned" ? "not filled in" : state;
                  return (
                    <div
                      key={hour}
                      className="cell mx-[2px] my-1"
                      data-date={date}
                      data-hour={hour}
                      data-state={state}
                      data-readonly={editable ? "false" : "true"}
                      data-selected={isToday ? "true" : "false"}
                      onPointerDown={onCellPointerDown}
                      role={editable ? "button" : undefined}
                      aria-label={`${weekdayOf(date)} ${shortDate(date)} ${hourLabel(hour)}, ${label}`}
                      tabIndex={editable ? 0 : -1}
                      onKeyDown={(event) => {
                        if (!editable) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          painted.current.clear();
                          paintCell(event.currentTarget, brush);
                        }
                      }}
                      title={`${hourLabel(hour)}–${hourLabel(hour + 1)} · ${label}`}
                    >
                      <span className="sr-only">{hourLabel(hour)}</span>
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* ---------------- per-day chips: the plain-English summary ---------------- */}
      <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {days.map((date) => {
          const day = map[date] ?? {};
          const hours = hoursFromStates(day);
          const counts = countStates(day);
          const isToday = date === today;
          const touched = counts.free + counts.busy > 0;
          return (
            <div
              key={date}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${
                touched ? "border-line bg-white" : "border-dashed border-line-2 bg-[#fbfaf8]"
              }`}
            >
              <span className="font-medium text-ink-2">
                {weekdayOf(date)} {fromISODate(date).getDate()}
                {isToday ? <span className="ml-1.5 text-[10.5px] font-semibold text-brand uppercase">today</span> : null}
              </span>
              <span className="flex items-center gap-2 text-right">
                {counts.free ? <span className="tabular-nums text-[#3f8f63]">{counts.free}h free</span> : null}
                {counts.busy ? <span className="tabular-nums text-[#b91c1c]">{counts.busy}h busy</span> : null}
                {!touched ? <span className="text-faint">not filled in</span> : null}
              </span>
              {editable ? (
                <button
                  type="button"
                  onClick={() => setDay(date, "unassigned")}
                  disabled={!touched}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-faint transition-colors hover:bg-[#f4f5fa] hover:text-ink-2 disabled:opacity-0"
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
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        <span className="tabular-nums">
          <b className="font-semibold text-[#3f8f63]">{weekTotal}h</b> free
        </span>
        {weekBusy ? (
          <span className="tabular-nums">
            <b className="font-semibold text-[#b91c1c]">{weekBusy}h</b> busy
          </span>
        ) : null}
        <span className="tabular-nums text-faint">{weekUnassigned}h unassigned</span>
      </div>

      {message ? (
        <div className="mt-3">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}
    </div>
  );
}
