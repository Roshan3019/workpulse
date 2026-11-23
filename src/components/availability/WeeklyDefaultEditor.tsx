"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Modal";
import { saveWeeklyDefaultAction } from "@/lib/actions/joining";
import { HOURS, PRESETS } from "@/lib/dates";
import { countStates } from "@/lib/availability";
import type { CellState } from "@/lib/availability";
import type { SlotState, WeeklyDefault } from "@/lib/types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * "My usual week" — set once, inherited by every future day that has no entry
 * of its own. Nothing is written ahead of time; this is a template, and any
 * day the person has edited keeps its own copy.
 */
export function WeeklyDefaultEditor({ initial }: { initial: WeeklyDefault | null }) {
  const router = useRouter();
  const [week, setWeek] = useState<WeeklyDefault>(() => initial ? { ...initial } : {});
  const [open, setOpen] = useState(false);
  // "unassigned" is the erase brush — it removes the key rather than storing a value.
  const [brush, setBrush] = useState<CellState>("free");
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const hasDefault = useMemo(() => Object.keys(initial ?? {}).length > 0, [initial]);
  const selectedDays = Object.keys(week).length;

  function paint(day: number, hours: readonly number[], state: CellState) {
    setWeek((prev) => {
      const next = { ...prev };
      const current = { ...(next[day] ?? {}) };
      for (const hour of hours) {
        if (state === "unassigned") delete current[hour];
        else current[hour] = state;
      }
      if (Object.keys(current).length) next[day] = current;
      else delete next[day];
      return next;
    });
    setMessage(null);
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
      const result = await saveWeeklyDefaultAction(
        Object.keys(week).length ? week : null,
      );
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
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
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
            <div className="inline-flex items-center gap-1 rounded-lg border border-line-2 bg-white p-0.5">
              {([
                { value: "free", label: "Free", dot: "bg-ok" },
                { value: "busy", label: "Busy", dot: "bg-bad/70" },
                { value: "unassigned", label: "Clear", dot: "bg-line-2" },
              ] as const).map((option) => (
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

            <span className="ml-auto text-[11.5px] text-faint">
              {selectedDays ? `${selectedDays} of 7 days set` : "Nothing set"}
            </span>
          </div>

          {/* the week as 7 rows of hour toggles */}
          <div className="space-y-1">
            {DAY_LABELS.map((label, day) => {
              const dayStates = week[day] ?? {};
              const counts = countStates(dayStates);
              return (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-[11.5px] font-medium text-muted">{label}</span>
                  <div className="flex flex-1 gap-[3px]">
                    {HOURS.map((hour) => {
                      const state = dayStates[hour] ?? "unassigned";
                      return (
                        <button
                          key={hour}
                          type="button"
                          onClick={() => paint(day, [hour], brush)}
                          aria-label={`${label} ${hour}:00, ${state}`}
                          title={`${label} ${String(hour).padStart(2, "0")}:00`}
                          className={`h-5 flex-1 rounded-[4px] transition-colors duration-150 ${
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

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={save} disabled={busy} className="btn-primary btn-sm">
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
            <span className="ml-auto text-[11.5px] text-faint">
              Scrolling hours? Tap a cell, not drag.
            </span>
          </div>

          {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        </div>
      ) : null}
    </div>
  );
}
