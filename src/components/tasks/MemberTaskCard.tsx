"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { ProgressSlider } from "@/components/tasks/ProgressSlider";
import { updateProgressAction } from "@/lib/actions/tasks";
import { TaskPlanDialog } from "@/components/tasks/TaskPlanDialog";
import { countdownLabel, dueDateOf, dueLabel, hourLabel } from "@/lib/dates";
import { blockHours, minutesLabel, PLAN_FIRST_HOUR } from "@/lib/plans";
import { STATUS_LABEL, type AvailabilityStates, type Task, type TaskPlan, type TaskStatus } from "@/lib/types";

const STATUS_TONE = {
  pending: "grey",
  in_progress: "indigo",
  done: "green",
} as const;

export function MemberTaskCard({
  task,
  plans = [],
  availability = {},
}: {
  task: Task;
  /** This member's planned blocks for this task (all days). */
  plans?: TaskPlan[];
  /** Their availability for the same window, so the dialog can warn about free hours. */
  availability?: AvailabilityStates;
}) {
  const [planOpen, setPlanOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState(task.progress);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [saved, setSaved] = useState(false);

  const done = status === "done";
  const overdue = Boolean(task.deadline) && !done && dueDateOf(task.deadline!, task.dueTime).getTime() < Date.now();

  function persist(nextProgress: number, nextStatus: TaskStatus) {
    startTransition(async () => {
      const result = await updateProgressAction({
        taskId: task.id,
        progress: nextProgress,
        status: nextStatus,
      });
      if (!result.error) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
        router.refresh();
      }
    });
  }

  /* Blocks for this task, in reading order, with the totals the header shows. */
  const plannedBlocks = [...plans].sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour);
  const plannedHoursTotal = plannedBlocks.reduce((sum, p) => sum + blockHours(p).length, 0);
  const plannedMinutesTotal = plannedBlocks.reduce((sum, p) => sum + Number(p.minutes || 0), 0);

  return (
    <article className="card p-5">
      <TaskPlanDialog
        task={{
          id: task.id,
          title: task.title,
          estHours: Number(task.estHours),
          deadline: task.deadline,
          startDate: task.startDate,
        }}
        plans={plans}
        availability={availability}
        open={planOpen}
        onClose={() => setPlanOpen(false)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-brand-dark">
          {task.client || "No client"}
        </span>
        {task.deadline ? (
          <Badge tone={done ? "green" : overdue ? "red" : "grey"}>
            {dueLabel(task.deadline, task.dueTime)}
            {!done ? ` · ${countdownLabel(task.deadline, task.dueTime)}` : ""}
          </Badge>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[12.5px] tabular-nums text-muted">{task.estHours}h</span>
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
        </span>
      </div>

      <h3 className="mt-2.5 text-[19px] font-semibold">{task.title}</h3>
      {task.description ? (
        <p className="mt-1 text-[13.5px] leading-relaxed break-words text-muted">{task.description}</p>
      ) : null}

      {/*
        Planning is per task, not per calendar: the member says "I'll do this
        2pm–6pm on the 24th" and the admin sees that as one block. The button
        carries the planned total so the card answers "have I set time aside
        for this?" without opening anything.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPlanOpen(true)}
          disabled={done}
          className="btn-outline btn-sm disabled:opacity-50"
        >
          {plannedMinutesTotal ? "Adjust my hours" : "Plan my hours"}
        </button>
        {plannedBlocks.length ? (
          <span className="text-[12px] text-muted">
            <b className="font-semibold text-ink-2">{new Set(plannedBlocks.map((p) => p.date)).size}</b>{" "}
            {new Set(plannedBlocks.map((p) => p.date)).size === 1 ? "day" : "days"} planned
            {" · "}
            <span className="tabular-nums">{plannedHoursTotal}h blocked</span>
            {plannedMinutesTotal ? ` · ${minutesLabel(plannedMinutesTotal)} of work` : ""}
          </span>
        ) : (
          <span className="text-[12px] text-faint">No hours set aside for this yet.</span>
        )}
      </div>
      {plannedBlocks.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {plannedBlocks.slice(0, 6).map((plan) => (
            <li
              key={plan.id}
              className="rounded-full border border-line bg-white px-2.5 py-1 text-[11.5px] font-medium text-ink-2"
            >
              {new Date(`${plan.date}T00:00:00`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}{" "}
              · {hourLabel(plan.startHour)}–{hourLabel(plan.endHour)}
            </li>
          ))}
          {plannedBlocks.length > 6 ? (
            <li className="rounded-full border border-line-2 px-2.5 py-1 text-[11.5px] text-faint">
              +{plannedBlocks.length - 6} more
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_220px] sm:items-end">
        <div>
          <ProgressSlider
            taskId={task.id}
            title={task.title}
            initialProgress={progress}
            status={status}
            onProgressChange={(value) => {
              setProgress(value);
              // Keep the status pill honest as the bar is dragged.
              if (value === 100 && status !== "done") setStatus("done");
              else if (value < 100 && status === "done") setStatus("in_progress");
            }}
          />
        </div>

        <div>
          <label htmlFor={`status-${task.id}`} className="label mb-2 block">
            Status
          </label>
          <select
            id={`status-${task.id}`}
            value={status}
            disabled={pending}
            onChange={(event) => {
              const value = event.target.value as TaskStatus;
              setStatus(value);
              const nextProgress = value === "done" ? 100 : progress;
              setProgress(nextProgress);
              persist(nextProgress, value);
            }}
            className="w-full rounded-xl border border-line-2 bg-white px-3.5 py-3 text-sm font-semibold outline-none focus:border-brand"
          >
            <option value="pending">Pending</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
        </div>
      </div>

      <div className="mt-2 h-4 text-[11.5px] font-bold text-ok-dark">{pending ? "Saving…" : ""}</div>
    </article>
  );
}
