"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Modal";
import { saveWeeklyDefaultAction } from "@/lib/actions/joining";
import { WORK_FIRST_HOUR, WORK_HOURS } from "@/lib/availability";
import { PRESETS, hourLabel } from "@/lib/dates";
import { countStates } from "@/lib/availability";
import type { CellState } from "@/lib/availability";
import type { SlotState, WeeklyDefault } from "@/lib/types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/*
 * The hours this editor shows come from `availability.ts` — the same 8a–7p
 * window the team-slot card and the availability grid paint, so a person can
 * line the three up without counting cells. (Those grids thin columns out on a
 * phone; this one keeps all twelve.)
 */
const FIRST_HOUR = WORK_FIRST_HOUR;

/**
 * "My usual week" — set once, inherited by every future day that has no entry
 * of its own. Nothing is written ahead of time; this is a template, and any day
 * the person has edited keeps its own copy.
 *
 * Interaction follows the availability calendar, not a spreadsheet: pick a
 * brush, then drag across cells to paint a run of hours. The hour labels across
 * the top (and the per-day total on the right) are what make a painted block
 * readable as *time* instead of coloured squares.
 */
export function WeeklyDefaultEditor({ initial }: { initial: WeeklyDefault | null }) {
  const router = useRouter();
  const [week, setWeek] = useState<WeeklyDefault>(() => (initial ? { ...initial } : {}));
  const [open, setOpen] = useState(false);
  // "unassigned" is the erase brush — it removes the key rather than storing a value.
  const [brush, setBrush] = useState<CellState>("free");
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const hasDefault = useMemo(() => Object.keys(initial ?? {}).length > 0, [initial]);
  const selectedDays = Object.keys(week).length;

  /*
   * Drag painting.
   *
   * Pointer events only (mouse, finger and pen all produce them), and the cell
   * under the finger is found with `elementFromPoint` rather than relying on
   * hover events — that is what lets one continuous drag cross the gaps
   * between cells at speed without dropping hours.
   *
   * `painted` makes the drag idempotent: crossing a cell twice cannot undo the
   * first touch, so dragging back over a row keeps what you meant to paint.
   */
  const dragging = useRef(false);
  const painted = useRef<Set<string>>(new Set());

  const paint = (day: number, hours: readonly number[], state: CellState) => {
    setWeek((prev) => {
      const next = { ...prev };
      const current = { ...(next[day] ?? {}) };
      for (const hour of hours) {
        if (state === "unassigned") delete current[hour];
        else current[hour] = state as SlotState;
      }
      if (Object.keys(current).length) next[day] = current;
      else delete next[day];
      return next;
    });
    setMessage(null);
  };

  const paintOne = (day: number, hour: number) => {
    const key = `${day}:${hour}`;
    if (painted.current.has(key)) return;
    painted.current.add(key);
    paint(day, [hour], brush);
  };

  useEffect(() => {
    if (!open) return;
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      painted.current.clear();
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      event.preventDefault();
      const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const cell = under?.closest<HTMLElement>("[data-slot-day]");
      if (!cell) return;
      const day = Number(cell.dataset.slotDay);
      const hour = Number(cell.dataset.slotHour);
      if (Number.isNaN(day) || Number.isNaN(hour)) return;
      paintOne(day, hour);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, brush]);

  function startDrag(day: number, hour: number) {
    painted.current.clear();
    dragging.current = true;
    paintOne(day, hour);
  }

  /** Mon–Fri at once — the common case. */
  function weekdays(hours: readonly number[]) {
    setWeek((prev) => {
      const next = { ...prev };
      for (const day of [1, 2, 3, 4, 5]) {
        next[day] = Object.fromEntries(hours.map((h) => [h, "free" as SlotState]));
      }
      return next;
    });
    setMessage(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveWeeklyDefaultAction(Object.keys(week).length ? week : null);
      if (result.error) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({
        tone: "success",
        text: Object.keys(week).length
          ? "Saved. Every future week now starts with this."
          : "Default removed. Empty days stay empty.",
      });
      router.refresh();
    });
  }

  function clear() {
    if (!window.confirm("Remove the default week? Days you've already filled in stay as they are.")) return;
    setWeek({});
    startTransition(async () => {
      const result = await saveWeeklyDefaultAction(null);
      if (result.error) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "success", text: "Default removed. Empty days stay empty." });
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-semibold text-ink">My usual week</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            {hasDefault
              ? "New weeks fill themselves in from this. Any day you edit keeps its own hours."
              : "Set your normal hours once and stop re-entering them every week."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="btn-outline btn-sm shrink-0"
          aria-expanded={open}
        >
          {open ? "Close" : hasDefault ? "Edit" : "Set up"}
        </button>
      </div>

      {open ? (
        <div className="space-y-3 border-t border-line px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* brush */}
            <div className="inline-flex items-center gap-1 rounded-lg border border-line-2 bg-white p-0.5" role="group" aria-label="What to paint">
              {(
                [
                  { value: "free", label: "Free", dot: "bg-ok" },
                  { value: "busy", label: "Busy", dot: "bg-bad/70" },
                  { value: "unassigned", label: "Clear", dot: "bg-line-2" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setBrush(option.value)}
                  aria-pressed={brush === option.value}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
                    brush === option.value ? "bg-[#f2efea] text-ink" : "text-muted hover:text-ink-2"
                  }`}
                >
                  <i className={`h-2 w-2 rounded-[3px] ${option.dot}`} aria-hidden="true" />
                  {option.label}
                </button>
              ))}
            </div>

            <select
              aria-label="Quick fill weekdays"
              defaultValue=""
              onChange={(event) => {
                const key = event.target.value as keyof typeof PRESETS | "";
                if (!key) return;
                weekdays(PRESETS[key]);
                event.currentTarget.value = "";
              }}
              className="rounded-lg border border-line-2 bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink-2 outline-none"
            >
              <option value="" disabled>
                Fill Mon–Fri…
              </option>
              <option value="standard">9am–5pm</option>
              <option value="mornings">Mornings</option>
              <option value="evenings">Evenings</option>
            </select>

            <span className="text-[11.5px] text-faint sm:ml-auto">
              {selectedDays ? `${selectedDays} of 7 days set` : "Nothing set"}
            </span>
          </div>

          {/*
            The week: hours across the top, days down the side — the same
            orientation as the team-slot card, so "8a to 12p on Monday" reads the
            same way in both places.
          */}
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              {/* hour rule */}
              <div className="mb-1 flex items-center gap-2">
                <span className="w-9 shrink-0" aria-hidden="true" />
                <div className="flex flex-1 gap-[3px]">
                  {WORK_HOURS.map((hour) => (
                    <div
                      key={hour}
                      className={`min-w-0 flex-1 text-center text-[10px] font-semibold tabular-nums text-faint ${
                        hour % 2 === 0 ? "" : "hidden sm:block"
                      }`}
                    >
                      {hourLabel(hour)}
                    </div>
                  ))}
                </div>
                <span className="w-10 shrink-0" aria-hidden="true" />
              </div>

              {DAY_LABELS.map((label, day) => {
                const dayStates = week[day] ?? {};
                const counts = countStates(dayStates);
                return (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-9 shrink-0 text-[11.5px] font-medium text-muted">{label}</span>
                    <div className="flex flex-1 touch-none gap-[3px] select-none">
                      {WORK_HOURS.map((hour) => {
                        const state = (dayStates[hour] ?? "unassigned") as CellState;
                        return (
                          <button
                            key={hour}
                            type="button"
                            data-slot-day={day}
                            data-slot-hour={hour}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              startDrag(day, hour);
                            }}
                            aria-label={`${label} ${String(hour).padStart(2, "0")}:00, ${state === "unassigned" ? "not set" : state}`}
                            title={`${label} ${hourLabel(hour)}–${hourLabel(hour + 1)} · ${
                              state === "unassigned" ? "not set" : state
                            }`}
                            className={`h-6 min-w-0 flex-1 cursor-pointer touch-none rounded-[4px] transition-colors duration-150 ${
                              hour % 2 === 0 ? "" : "hidden sm:block"
                            } ${
                              state === "free"
                                ? "bg-ok hover:bg-ok-dark"
                                : state === "busy"
                                  ? "bg-bad/45 hover:bg-bad/60"
                                  : "bg-[#f1eee9] ring-1 ring-inset ring-[#e6e1d9] hover:bg-[#eae5dd]"
                            }`}
                          />
                        );
                      })}
                    </div>
                    <span className="w-10 shrink-0 text-right text-[10.5px] tabular-nums text-faint">
                      {counts.free ? `${counts.free}h` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-[11.5px] leading-relaxed text-faint">
            Drag across a row to paint a run of hours. Weekdays are Mon–Fri; the hours shown are
            8am–7pm, the same window as your calendar.
          </p>

          <div className="grid gap-2 pt-1 sm:flex sm:flex-wrap sm:items-center">
            <button type="button" onClick={save} disabled={busy} className="btn-primary btn-sm w-full sm:w-auto">
              {busy ? "Saving…" : "Save default"}
            </button>
            {hasDefault ? (
              <button
                type="button"
                onClick={clear}
                disabled={busy}
                className="rounded-md px-2 py-1.5 text-[12px] font-medium text-muted transition-colors hover:text-[#b91c1c] disabled:opacity-50"
              >
                Remove default
              </button>
            ) : null}
            <span className="text-[11.5px] text-faint sm:ml-auto">
              Scrolling the table sideways on a phone? Drag itself paints — tap and hold, then move.
            </span>
          </div>

          {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        </div>
      ) : null}
    </div>
  );
}
