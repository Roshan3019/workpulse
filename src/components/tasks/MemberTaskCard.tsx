"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { ProgressSlider } from "@/components/tasks/ProgressSlider";
import { updateProgressAction } from "@/lib/actions/tasks";
import { countdownLabel, dueDateOf, dueLabel } from "@/lib/dates";
import { STATUS_LABEL, type Task, type TaskStatus } from "@/lib/types";

const STATUS_TONE = {
  pending: "grey",
  in_progress: "indigo",
  done: "green",
} as const;

export function MemberTaskCard({ task }: { task: Task }) {
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

  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-extrabold tracking-[.06em] text-brand-dark uppercase">
          {task.client || "No client"}
        </span>
        {task.deadline ? (
          <Badge tone={done ? "green" : overdue ? "red" : "grey"}>
            📅 {dueLabel(task.deadline, task.dueTime)}
            {!done ? ` · ${countdownLabel(task.deadline, task.dueTime)}` : ""}
          </Badge>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[13px] text-muted">🕐 {task.estHours}h</span>
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
        </span>
      </div>

      <h3 className="mt-2.5 text-[19px] font-extrabold">{task.title}</h3>
      {task.description ? (
        <p className="mt-1 text-[13.5px] leading-relaxed break-words text-muted">{task.description}</p>
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
