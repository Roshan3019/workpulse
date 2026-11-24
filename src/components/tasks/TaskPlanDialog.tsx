"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Modal";
import { clearTaskPlanAction, saveTaskPlanAction } from "@/lib/actions/tasks";
import { hourLabel } from "@/lib/dates";
import {
  PLAN_FIRST_HOUR,
  PLAN_HOURS,
  PLAN_LAST_HOUR,
  blockHours,
  minutesLabel,
  normaliseBlocks,
  type PlanDraft,
} from "@/lib/plans";
import type { AvailabilityStates, TaskPlan } from "@/lib/types";

/*
 * "Plan my hours" — the member paints the hours they'll work on one task.
 *
 * Interaction is the same one the availability calendar already taught them:
 * press a cell and drag across a run of hours. The difference is what a drag
 * *means* here: a drag is one block, so 2pm→6pm becomes a single 4-hour bar
 * rather than four decisions, and anything the member already planned that
 * touches it merges instead of sitting next to it with a seam.
 *
 * The small overlap note exists because planning hours marks that time busy:
 * if a block lands on hours they had marked free, they can see that it replaced
 * "free" before they save, not after.
 */

const PAINT = PLAN_HOURS;

function findBlocks(plans: TaskPlan[], date: string): PlanDraft[] {
  return normaliseBlocks(
    plans
      .filter((p) => p.date === date)
      .map((p) => ({ date: p.date, startHour: p.startHour, endHour: p.endHour, minutes: p.minutes })),
  );
}

export function TaskPlanDialog({
  task,
  plans: initialPlans,
  availability,
  open,
  onClose,
}: {
  task: { id: string; title: string; estHours: number; deadline: string | null; startDate: string | null };
  /** This member's plans for this task, every day. */
  plans: TaskPlan[];
  /** Their availability states for the same window, to warn about free hours. */
  availability: AvailabilityStates;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState<string>(
    () => initialPlans[0]?.date ?? task.startDate ?? task.deadline ?? "",
  );
  const [blocks, setBlocks] = useState<PlanDraft[]>(() => findBlocks(initialPlans, initialPlans[0]?.date ?? ""));
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* The window offered is the two weeks from today, same as every other grid. */
  const days = useMemo(() => {
    const out: string[] = [];
    const base = new Date();
    for (let i = 0; i < 14; i += 1) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }, []);

  /* Keep the painted blocks in step when the day switches. */
  const lastDate = useRef(date);
  useEffect(() => {
    if (lastDate.current === date) return;
    lastDate.current = date;
    setBlocks(findBlocks(initialPlans, date));
    setSaved(null);
    setError(null);
  }, [date, initialPlans]);

  /*
   * Opening with nothing planned pre-paints a sensible first block for the day
   * the member is most likely to mean (the task's start day, else its due day,
   * else today), sized to the estimate and sitting inside the working window.
   * It is a suggestion they can drag over — not saved until they say so.
   */
  useEffect(() => {
    if (!open) return;
    setBlocks((prev) => {
      if (prev.length || initialPlans.length) return prev;
      const estimate = Math.max(1, Math.min(8, Math.round(Number(task.estHours) || 1)));
      const start = Math.max(PLAN_FIRST_HOUR, Math.min(14, PLAN_LAST_HOUR - estimate));
      return [
        {
          date,
          startHour: start,
          endHour: Math.min(PLAN_LAST_HOUR + 1, start + estimate),
          minutes: estimate * 60,
        },
      ];
    });
  }, [open, initialPlans.length, task.estHours, date]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const dragging = useRef(false);
  const painted = useRef<Set<string>>(new Set());

  /** Every hour any block covers, for a quick "is this painted" test. */
  const covered = useMemo(() => {
    const set = new Set<number>();
    for (const b of blocks) for (const h of blockHours(b)) set.add(h);
    return set;
  }, [blocks]);

  /**
   * One drag = one block. The anchor is remembered so dragging backwards works,
   * and the painted set stops a wobble from adding a second hour twice.
   */
  const anchor = useRef<number | null>(null);

  function paintTo(hour: number) {
    if (anchor.current === null) return;
    const start = Math.min(anchor.current, hour);
    const end = Math.max(anchor.current, hour) + 1;
    const key = `${start}:${end}`;
    if (painted.current.has(key)) return;
    painted.current.add(key);

    setBlocks((prev) => {
      /*
       * The run being dragged *replaces* whatever it crosses: dragging over an
       * existing block and stopping halfway should shorten it, not add a
       * second one on top. Anything left over on either side survives.
       */
      const survivors: PlanDraft[] = [];
      for (const block of prev) {
        if (block.endHour <= start || block.startHour >= end) {
          survivors.push(block);
          continue;
        }
        if (block.startHour < start) {
          survivors.push({ ...block, endHour: start });
        }
        if (block.endHour > end) {
          survivors.push({ ...block, startHour: end });
        }
      }
      const total = survivors.reduce((sum, b) => sum + b.minutes, 0);
      const estimate = Math.max(0, Math.round(Number(task.estHours || 0) * 60));
      const minutes = Math.min((end - start) * 60, Math.max(0, estimate - total));
      return normaliseBlocks([...survivors, { date, startHour: start, endHour: end, minutes }]);
    });
    setSaved(null);
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    const end = () => {
      dragging.current = false;
      anchor.current = null;
      painted.current.clear();
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      event.preventDefault();
      const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const cell = under?.closest<HTMLElement>("[data-plan-hour]");
      if (!cell) return;
      const hour = Number(cell.dataset.planHour);
      if (Number.isNaN(hour)) return;
      paintTo(hour);
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
  }, [open, date, blocks]);

  function onCellDown(hour: number) {
    if (pending) return;
    /*
     * Pressing a cell inside an existing block starts a *resize* from that
     * block's far edge, so a 4-hour bar survives the first touch and can be
     * stretched or shortened. Pressing an unpainted cell paints a new hour —
     * and does not wipe out the suggestion the dialog opened with.
     */
    const inside = blocks.find((b) => b.startHour <= hour && b.endHour > hour);
    painted.current.clear();
    dragging.current = true;
    if (inside) {
      /*
       * Resize from the far edge: pressing 2pm inside a 2–6 block and dragging
       * to 4pm shortens it to 2–4, and dragging to 8pm stretches it. The block
       * itself stays put — it is not cleared and re-painted under the finger.
       */
      anchor.current = hour === inside.startHour ? inside.startHour : hour;
      if (hour === inside.startHour) {
        // Pressing the very first hour starts a fresh block from there.
        paintTo(hour);
        return;
      }
      setBlocks((prev) => normaliseBlocks(prev.map((b) => (b === inside ? { ...b } : b))));
      setSaved(null);
      // No `paintTo` until the pointer actually moves to another hour, so a
      // plain click inside a block never shrinks it to one hour.
      painted.current.add(`${inside.startHour}:${inside.endHour}`);
      return;
    }
    anchor.current = hour;
    paintTo(hour);
  }

  /** Drag with the keyboard too: shift+arrow grows the last block. */
  function nudge(hour: number, direction: 1 | -1) {
    setBlocks((prev) => {
      const hit = prev.find((b) => b.startHour <= hour && b.endHour > hour);
      if (!hit) return prev;
      const next = normaliseBlocks([
        ...prev.filter((b) => b !== hit),
        { ...hit, endHour: Math.min(24, Math.max(hit.startHour + 1, hit.endHour + direction)) },
      ]);
      return next;
    });
    setSaved(null);
  }

  const totalMinutes = blocks.reduce((sum, b) => sum + b.minutes, 0);
  const totalHours = blocks.reduce((sum, b) => sum + (b.endHour - b.startHour), 0);
  const overFree = useMemo(() => {
    const states = availability[date] ?? {};
    const hit: number[] = [];
    for (const b of blocks) {
      for (const h of blockHours(b)) if (states[h] === "free") hit.push(h);
    }
    return hit;
  }, [availability, date, blocks]);

  function save() {
    startTransition(async () => {
      const result = await saveTaskPlanAction({
        taskId: task.id,
        date,
        blocks: blocks.map((b) => ({ startHour: b.startHour, endHour: b.endHour, minutes: b.minutes })),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(`Saved. ${totalHours}h on ${date} is now busy on your calendar.`);
      router.refresh();
    });
  }

  function removeAll() {
    startTransition(async () => {
      const result = await clearTaskPlanAction({ taskId: task.id, date });
      if (result.error) {
        setError(result.error);
        return;
      }
      setBlocks([]);
      setSaved("Cleared for this day.");
      router.refresh();
    });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Plan hours for ${task.title}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="animate-slide-in max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-t-[16px] border border-line bg-white p-5 shadow-xl sm:rounded-[16px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-[.06em] text-faint uppercase">
              Plan my hours
            </p>
            <h2 className="mt-1 truncate text-[19px] font-semibold">{task.title}</h2>
            <p className="mt-1 text-[12.5px] text-muted">
              Drag across the hours you&apos;ll work on this. They show on your admin&apos;s team view
              as one block with the task name.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-medium text-muted hover:bg-[#f8f6f3] hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* day picker */}
        <label className="mt-4 block">
          <span className="label mb-1.5 block">Which day?</span>
          <select
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-full rounded-xl border border-line-2 bg-white px-3 py-2.5 text-[13.5px] font-semibold outline-none focus:border-brand"
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
                {d === task.deadline ? " · due" : ""}
              </option>
            ))}
          </select>
        </label>

        {/* the strip to paint */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label">Hours</span>
            <span className="text-[12px] font-medium text-muted tabular-nums">
              {totalHours}h planned{totalMinutes ? ` · ${minutesLabel(totalMinutes)} of work` : ""}
            </span>
          </div>
          <div className="grid grid-cols-12 gap-[3px]">
            {PAINT.map((hour) => {
              const block = blocks.find((b) => b.startHour <= hour && b.endHour > hour);
              const first = block && block.startHour === hour;
              const last = block && block.endHour === hour + 1;
              return (
                <button
                  key={hour}
                  type="button"
                  data-plan-hour={hour}
                  data-state={block ? "planned" : (availability[date]?.[hour] ?? "unassigned")}
                  data-plan={block ? (first && last ? "only" : first ? "first" : last ? "last" : "middle") : undefined}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    onCellDown(hour);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onCellDown(hour);
                    }
                    if (event.key === "ArrowRight" && event.shiftKey) nudge(hour, 1);
                    if (event.key === "ArrowLeft" && event.shiftKey) nudge(hour, -1);
                  }}
                  title={
                    block
                      ? `${task.title} · ${hourLabel(block.startHour)}–${hourLabel(block.endHour)}`
                      : `${hourLabel(hour)} · ${availability[date]?.[hour] ?? "not filled in"}`
                  }
                  className={`cell mx-0 my-0 flex min-w-0 items-center justify-center text-[10px] font-semibold ${
                    block ? "text-white" : "text-faint"
                  }`}
                  aria-pressed={Boolean(block)}
                  aria-label={`${hourLabel(hour)}, ${block ? "planned for this task" : "not planned"}`}
                >
                  {hourLabel(hour).replace("a", "").replace("p", "")}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: "#8a4a2c" }} aria-hidden="true" />
              Plan for this task
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-ok" aria-hidden="true" /> Free
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-bad/55" aria-hidden="true" /> Busy
            </span>
          </div>
          {overFree.length ? (
            <p className="mt-2 rounded-lg border border-brand-line bg-brand-soft px-3 py-2 text-[12px] font-medium text-brand-dark">
              Planning these hours marks them busy, so {overFree.length === 1 ? "one hour" : `${overFree.length} hours`} you
              had marked free will show as this task instead.
            </p>
          ) : null}
        </div>

        {blocks.length ? (
          <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
            {blocks.map((block) => (
              <li key={`${block.startHour}-${block.endHour}`} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                <span className="font-semibold text-ink">
                  {hourLabel(block.startHour)}–{hourLabel(block.endHour)}
                </span>
                <span className="text-muted">{block.endHour - block.startHour}h block</span>
                <label className="ml-auto flex items-center gap-1.5 text-[11.5px] text-muted">
                  <span className="sr-only">Hours of work in this block</span>
                  <input
                    type="number"
                    min={0}
                    max={(block.endHour - block.startHour) * 60}
                    step={15}
                    value={block.minutes}
                    onChange={(event) => {
                      const minutes = Math.max(
                        0,
                        Math.min((block.endHour - block.startHour) * 60, Math.round(Number(event.target.value) || 0)),
                      );
                      setBlocks((prev) =>
                        normaliseBlocks(
                          prev.map((b) =>
                            b.startHour === block.startHour ? { ...b, minutes } : b,
                          ),
                        ),
                      );
                      setSaved(null);
                    }}
                    className="w-[68px] rounded-lg border border-line-2 px-2 py-1 text-[12px] font-semibold tabular-nums outline-none focus:border-brand"
                  />
                  <span className="tabular-nums">min</span>
                  <span className="text-faint tabular-nums">({minutesLabel(block.minutes)})</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-line-2 bg-[#fbfaf8] px-3 py-2.5 text-[12.5px] text-muted">
            Nothing planned for this day yet. Drag across the hours above.
          </p>
        )}

        {error ? (
          <div className="mt-3">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
        {saved ? (
          <div className="mt-3">
            <Alert tone="success">{saved}</Alert>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={pending} className="btn-primary btn-sm">
            {pending ? "Saving…" : "Save my hours"}
          </button>
          <button
            type="button"
            onClick={removeAll}
            disabled={pending || !initialPlans.some((p) => p.date === date)}
            className="btn-outline btn-sm disabled:opacity-50"
          >
            Clear this day
          </button>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm ml-auto">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
