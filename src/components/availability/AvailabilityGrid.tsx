"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Modal";
import { bulkSaveAvailabilityAction } from "@/lib/actions/availability";
import { HOURS, PRESETS, dayLabel, hourLabel, shortDate, todayISO, weekdayOf, fromISODate } from "@/lib/dates";
import type { AvailabilityMap } from "@/lib/types";

type Mode = "edit" | "read";

export function AvailabilityGrid({
  dates,
  initial,
  mode,
  emptyHint,
}: {
  dates: string[];
  initial: AvailabilityMap;
  mode: Mode;
  emptyHint?: string;
}) {
  const router = useRouter();
  const editable = mode === "edit";
  const [map, setMap] = useState<AvailabilityMap>(() => ({ ...initial }));
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string>(todayISO());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const dragging = useRef(false);
  const paintFree = useRef(true);
  const painted = useRef<Set<string>>(new Set());

  // Reset when the server sends fresh data after a refresh.
  useEffect(() => {
    setMap({ ...initial });
    setDirty(false);
  }, [initial]);

  const totalFor = useCallback((date: string) => (map[date] ?? []).length, [map]);
  const totals = useMemo(() => {
    const next7 = dates.slice(0, 7);
    const sum = (list: string[]) => list.reduce((acc, d) => acc + (map[d]?.length ?? 0), 0);
    return { week: sum(next7), all: sum(dates), today: (map[selected] ?? []).length };
  }, [map, dates, selected]);

  const paintCell = useCallback(
    (el: HTMLElement) => {
      const date = el.dataset.date;
      const hour = Number(el.dataset.hour);
      if (!date || Number.isNaN(hour)) return;
      const key = `${date}:${hour}`;
      if (painted.current.has(key)) return;
      painted.current.add(key);

      setMap((prev) => {
        const current = new Set(prev[date] ?? []);
        if (paintFree.current) current.add(hour);
        else current.delete(hour);
        const nextHours = [...current].sort((a, b) => a - b);
        const next = { ...prev };
        if (nextHours.length) next[date] = nextHours;
        else delete next[date];
        return next;
      });
      setDirty(true);
    },
    [],
  );

  useEffect(() => {
    if (!editable) return;

    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const cell = target?.closest<HTMLElement>(".cell");
      if (cell && cell.dataset.readonly !== "true") {
        event.preventDefault();
        paintCell(cell);
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
  }, [editable, paintCell]);

  function onCellPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!editable) return;
    event.preventDefault();
    const el = event.currentTarget;
    paintFree.current = el.dataset.free !== "true";
    painted.current.clear();
    dragging.current = true;
    paintCell(el);
  }

  function applyPreset(hours: readonly number[]) {
    setMap((prev) => ({ ...prev, [selected]: [...hours] }));
    setDirty(true);
    setMessage(null);
  }

  function clearDay() {
    setMap((prev) => {
      const next = { ...prev };
      delete next[selected];
      return next;
    });
    setDirty(true);
    setMessage(null);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const entries = dates.map((date) => ({ date, hours: map[date] ?? [] }));
    const result = await bulkSaveAvailabilityAction(entries);
    setSaving(false);
    if (result.error) setMessage({ tone: "error", text: result.error });
    else {
      setMessage({ tone: "success", text: "Availability saved." });
      setDirty(false);
      router.refresh();
    }
  }

  const selectedWeekday = weekdayOf(selected);

  return (
    <div>
      {/* date strip */}
      <div className="scroll-x -mx-1 flex gap-2 px-1 pb-3">
        {dates.map((date) => {
          const hours = totalFor(date);
          const isSelected = date === selected;
          const isToday = date === todayISO();
          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelected(date)}
              aria-pressed={isSelected}
              className={`min-w-[62px] shrink-0 rounded-2xl border px-2.5 py-2 text-center transition ${
                isSelected
                  ? "border-brand bg-brand text-white shadow-[0_4px_12px_rgba(79,70,229,.3)]"
                  : isToday
                    ? "border-brand bg-white"
                    : "border-line-2 bg-white hover:border-[#c7ccdf]"
              }`}
            >
              <span className={`block text-[10px] font-extrabold tracking-[.08em] uppercase ${isSelected ? "text-white/75" : "text-muted"}`}>
                {weekdayOf(date)}
              </span>
              <span className="block text-[17px] leading-tight font-extrabold">{fromISODate(date).getDate()}</span>
              <span className={`block text-[10.5px] font-bold ${isSelected ? "text-white/75" : hours ? "text-ok-dark" : "text-faint"}`}>
                {hours}h free
              </span>
            </button>
          );
        })}
      </div>

      {/* grid */}
      <div className="scroll-x rounded-2xl border border-line bg-white">
        <div className="min-w-[720px]">
          {/* hour header */}
          <div className="grid border-b border-line bg-[#fafaff]" style={{ gridTemplateColumns: `104px repeat(${HOURS.length}, minmax(0,1fr))` }}>
            <div />
            {HOURS.map((hour) => (
              <div key={hour} className="py-2 text-center text-[10.5px] font-bold text-faint">
                {hourLabel(hour)}
              </div>
            ))}
          </div>

          {dates.map((date) => {
            const freeSet = new Set(map[date] ?? []);
            const isSelected = date === selected;
            return (
              <div
                key={date}
                className="grid border-b border-[#f0f1f7] last:border-b-0"
                style={{ gridTemplateColumns: `104px repeat(${HOURS.length}, minmax(0,1fr))` }}
              >
                <div
                  className={`flex flex-col justify-center px-2.5 py-1 text-[11.5px] leading-tight font-extrabold ${isSelected ? "bg-brand-soft" : "bg-[#fafaff]"}`}
                >
                  <span>{dayLabel(date)}</span>
                  <span className="text-[10px] font-semibold text-faint">
                    {freeSet.size ? `${freeSet.size}h free` : "busy"}
                  </span>
                </div>
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="cell"
                    data-date={date}
                    data-hour={hour}
                    data-free={freeSet.has(hour) ? "true" : "false"}
                    data-readonly={editable ? "false" : "true"}
                    data-selected={isSelected ? "true" : "false"}
                    onPointerDown={onCellPointerDown}
                    role={editable ? "button" : undefined}
                    aria-label={`${dayLabel(date)} ${hourLabel(hour)} ${freeSet.has(hour) ? "free" : "busy"}`}
                    tabIndex={editable ? 0 : -1}
                    onKeyDown={(event) => {
                      if (!editable) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        paintFree.current = !freeSet.has(hour);
                        painted.current.clear();
                        paintCell(event.currentTarget);
                      }
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* footer */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3.5 w-3.5 rounded bg-ok" /> Free
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3.5 w-3.5 rounded border border-[#e3e6f2] bg-[#eef1f8]" /> Busy / unset
        </span>
        {editable ? (
          <>
            <span className="hidden sm:inline">Tip: drag across cells to paint — start on green to erase.</span>
            {dirty ? (
              <span className="flex items-center gap-1.5 font-bold text-warn-dark">
                <i className="inline-block h-2 w-2 rounded-full bg-warn" /> Unsaved changes
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-faint">View only — {emptyHint ?? "this teammate edits their own calendar."}</span>
        )}
        <span className="ml-auto font-bold text-ink-2">
          {shortDate(selected)}: {totals.today}h · Next 7 days: {totals.week}h · 14 days: {totals.all}h
        </span>
      </div>

      {/* toolbar */}
      {editable ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => applyPreset(PRESETS.standard)} className="btn-outline btn-sm">
            ☀ Standard 9–5
          </button>
          <button type="button" onClick={() => applyPreset(PRESETS.mornings)} className="btn-outline btn-sm">
            🌅 Mornings
          </button>
          <button type="button" onClick={() => applyPreset(PRESETS.evenings)} className="btn-outline btn-sm">
            🌙 Evenings
          </button>
          <button type="button" onClick={clearDay} className="btn-outline btn-sm">
            🧹 Clear {selectedWeekday}
          </button>
          <button type="button" onClick={save} disabled={saving || !dirty} className="btn-primary btn-sm ml-auto">
            {saving ? "Saving…" : "💾 Save availability"}
          </button>
        </div>
      ) : null}

      {message ? (
        <div className="mt-3">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}
    </div>
  );
}
