"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProgressAction } from "@/lib/actions/tasks";
import type { TaskStatus } from "@/lib/types";

const STEPS = [0, 25, 50, 75, 100] as const;

/**
 * Task progress control.
 *
 * A bare <input type=range> only moved when you grabbed the 14px native thumb,
 * and saved on every pixel of the drag. This adds:
 *   • a sized track/thumb with a visible fill (see `.range` in globals.css)
 *   • click-anywhere-on-the-track to jump (native, but now the hit area is 34px)
 *   • arrow-key ±5% and Home/End, so it is usable without a pointer
 *   • 25/50/75/100% quick buttons
 *   • one save at the end of the drag instead of a request per pixel
 */
export function ProgressSlider({
  taskId,
  title,
  initialProgress,
  status,
  onProgressChange,
}: {
  taskId: string;
  title: string;
  initialProgress: number;
  status: TaskStatus;
  onProgressChange?: (value: number) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialProgress);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | null>(null);

  // Server data wins after a refresh.
  useEffect(() => {
    setValue(initialProgress);
  }, [initialProgress]);

  function save(next: number) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setSaving(true);
      const nextStatus: TaskStatus = next === 100 ? "done" : status === "done" ? "in_progress" : status;
      const result = await updateProgressAction({ taskId, progress: next, status: nextStatus });
      setSaving(false);
      if (!result.error) {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1600);
        router.refresh();
      }
    }, 350);
  }

  function change(next: number) {
    const clamped = Math.min(100, Math.max(0, Math.round(next)));
    setValue(clamped);
    onProgressChange?.(clamped);
    save(clamped);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={`progress-${taskId}`} className="label !mb-0">
          Progress
        </label>
        <span className="text-[13.5px] font-semibold tabular-nums">{value}%</span>
      </div>

      <input
        id={`progress-${taskId}`}
        type="range"
        className="range"
        min={0}
        max={100}
        step={5}
        value={value}
        aria-label={`Progress for ${title}`}
        aria-valuetext={`${value} percent`}
        style={{ ["--fill" as string]: `${value}%` }}
        onChange={(event) => change(Number(event.target.value))}
        onKeyDown={(event) => {
          // 5% steps feel better than the browser's default 1.
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            change(value + 5);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            change(value - 5);
          } else if (event.key === "Home") {
            event.preventDefault();
            change(0);
          } else if (event.key === "End") {
            event.preventDefault();
            change(100);
          }
        }}
      />

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {STEPS.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => change(step)}
            aria-pressed={value === step}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition ${
              value === step
                ? "border-brand bg-brand-soft text-brand-dark"
                : "border-line-2 bg-white text-muted hover:border-[#c9c2b6] hover:text-ink"
            }`}
          >
            {step}%
          </button>
        ))}
        <span className="ml-auto h-4 text-[11.5px] font-bold text-ok-dark">
          {saving ? "Saving…" : saved ? "Saved ✓" : ""}
        </span>
      </div>
    </div>
  );
}
