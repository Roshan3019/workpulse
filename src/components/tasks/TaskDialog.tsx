"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Alert } from "@/components/ui/Modal";
import { saveTaskAction, type ActionResult } from "@/lib/actions/tasks";
import type { Member, Task } from "@/lib/types";
import { todayISO } from "@/lib/dates";

const initial: ActionResult = {};

type Props = {
  members: Member[];
  task?: Task;
  triggerClassName?: string;
  triggerLabel?: string;
  variant?: "primary" | "icon";
};

export function TaskDialog({ members, task, triggerClassName, triggerLabel, variant = "primary" }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const editing = Boolean(task);

  const [state, action, pending] = useActionState(async (_prev: ActionResult, formData: FormData) => {
    const result = await saveTaskAction(formData);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    }
    return result;
  }, initial);

  const [progress, setProgress] = useState(task?.progress ?? 0);
  useEffect(() => {
    if (open) setProgress(task?.progress ?? 0);
  }, [open, task?.progress]);

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Edit task"
          className={triggerClassName ?? "grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-[#f1f3fa] hover:text-ink"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={triggerClassName ?? "btn-primary"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {triggerLabel ?? "Assign new task"}
        </button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit task" : "Assign new task"}
        subtitle="Give a freelancer a client task with an estimate and deadline. Workload bars update instantly."
        wide
      >
        <form action={action} className="space-y-4">
          {task ? <input type="hidden" name="id" value={task.id} /> : null}

          <div className="field">
            <label htmlFor="title">Task title *</label>
            <input id="title" name="title" required maxLength={160} defaultValue={task?.title} placeholder="e.g. Designing Website" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="client">Client *</label>
              <input id="client" name="client" required maxLength={120} defaultValue={task?.client} placeholder="e.g. Qween" />
            </div>
            <div className="field">
              <label htmlFor="assigneeId">Assign to *</label>
              <select id="assigneeId" name="assigneeId" required defaultValue={task?.assigneeId ?? ""}>
                <option value="" disabled>
                  Choose a teammate
                </option>
                {members
                  .filter((m) => m.role === "member" || m.userId === task?.assigneeId)
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.profile.fullName ?? m.profile.email} — {m.profile.email}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="description">Description / reference link</label>
            <textarea id="description" name="description" rows={2} maxLength={4000} defaultValue={task?.description ?? ""} placeholder="Notes, Drive link, brief…" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="estHours">Estimated hours *</label>
              <input
                id="estHours"
                name="estHours"
                type="number"
                min={0.25}
                step={0.25}
                required
                defaultValue={task?.estHours ?? ""}
                placeholder="5"
              />
            </div>
            <div className="field">
              <label htmlFor="deadline">Deadline</label>
              <input id="deadline" name="deadline" type="date" min="2000-01-01" defaultValue={task?.deadline ?? todayISO()} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="priority">Priority</label>
              <select id="priority" name="priority" defaultValue={task?.priority ?? "medium"}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={task?.status ?? "pending"}>
                <option value="pending">Pending</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="progress">
              Progress — <span className="text-ink">{progress}%</span>
            </label>
            <input
              id="progress"
              name="progress"
              type="range"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[#e4e7f5] accent-brand"
            />
          </div>

          {state?.error ? <Alert tone="error">{state.error}</Alert> : null}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-outline">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? "Saving…" : editing ? "Save changes" : "Assign task"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
