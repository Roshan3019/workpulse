"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Alert } from "@/components/ui/Modal";
import { saveTaskAction, type ActionResult } from "@/lib/actions/tasks";
import type { Member, Task, Team } from "@/lib/types";
import { addDays, countdownLabel, todayISO, TIME_PRESETS } from "@/lib/dates";

const initial: ActionResult = {};

type Props = {
  members: Member[];
  teams?: Team[];
  task?: Task;
  triggerClassName?: string;
  triggerLabel?: string;
  variant?: "primary" | "icon";
};

export function TaskDialog({
  members,
  teams = [],
  task,
  triggerClassName,
  triggerLabel,
  variant = "primary",
}: Props) {
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

  // Live timing state so the dialog reflects what you pick, not a static default.
  const [startDate, setStartDate] = useState(task?.startDate ?? todayISO());
  const [dueDate, setDueDate] = useState(task?.deadline ?? todayISO());
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "18:00");

  useEffect(() => {
    if (!open) return;
    setStartDate(task?.startDate ?? todayISO());
    setDueDate(task?.deadline ?? todayISO());
    setDueTime(task?.dueTime ?? "18:00");
  }, [open, task?.startDate, task?.deadline, task?.dueTime]);

  /*
   * The preset chips highlight by *distance from today*, never by comparing
   * against a date computed during render. Two clocks in one render is what
   * made "Tomorrow" stay lit while the date field said something else.
   */
  const dueOffset = Math.round(
    (new Date(`${dueDate}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()) /
      86_400_000,
  );

  const timingSummary = dueDate
    ? `${countdownLabel(dueDate, dueTime)}${startDate ? ` · ${Math.max(0, Math.round((new Date(dueDate).getTime() - new Date(startDate).getTime()) / 86_400_000))} day window` : ""}`
    : null;

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
        subtitle="Estimate, schedule and assign in one go. Workload bars update instantly."
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
                      {m.profile.fullName ?? m.profile.email} ({m.profile.email})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {teams.length ? (
            <div className="field">
              <label htmlFor="teamId">Team</label>
              <select id="teamId" name="teamId" defaultValue={task?.teamId ?? ""}>
                <option value="">No team (studio-wide)</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="description">Description / reference link</label>
            <textarea id="description" name="description" rows={2} maxLength={4000} defaultValue={task?.description ?? ""} placeholder="Notes, Drive link, brief…" />
          </div>

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

          {/* ---- timing: start → due, with a live countdown ---- */}
          <div className="rounded-xl border border-line bg-[#fafaff] p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <span className="label !mb-0">Timing</span>
              {timingSummary ? (
                <span className="rounded-full border border-brand-line bg-white px-2.5 py-0.5 text-[11.5px] font-bold text-brand-dark">
                  {timingSummary}
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="field">
                <label htmlFor="startDate">Start</label>
                <input
                  id="startDate"
                  name="startDate"
                  type="date"
                  defaultValue={task?.startDate ?? startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="deadline">Due date</label>
                <input
                  id="deadline"
                  name="deadline"
                  type="date"
                  min="2000-01-01"
                  defaultValue={task?.deadline ?? dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="dueTime">Due time</label>
                <input
                  id="dueTime"
                  name="dueTime"
                  type="time"
                  defaultValue={task?.dueTime ?? "18:00"}
                  onChange={(e) => setDueTime(e.target.value)}
                />
              </div>
            </div>

            {/* ---- quick picks ----------------------------------------------
                Two clearly separate groups, each on its own line, so the
                row never wraps mid-group and the chips keep one height. */}
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-14 shrink-0 text-[11px] font-bold tracking-[.06em] text-faint uppercase">
                  Due in
                </span>
                {[
                  { label: "Today", days: 0 },
                  { label: "Tomorrow", days: 1 },
                  { label: "3 days", days: 3 },
                  { label: "1 week", days: 7 },
                  { label: "2 weeks", days: 14 },
                ].map((option) => {
                  const active = dueOffset === option.days;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setDueDate(addDays(todayISO(), option.days))}
                      className={`chip h-8 rounded-full border px-3 text-[12px] font-semibold transition ${
                        active
                          ? "border-brand bg-brand text-white shadow-[0_3px_10px_rgba(79,70,229,.28)]"
                          : "border-line-2 bg-white text-muted hover:border-[#c7ccdf] hover:text-ink"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-14 shrink-0 text-[11px] font-bold tracking-[.06em] text-faint uppercase">
                  Time
                </span>
                {TIME_PRESETS.map((preset) => {
                  const active = dueTime === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setDueTime(preset.value)}
                      className={`chip h-8 rounded-full border px-3 text-[12px] font-semibold transition ${
                        active
                          ? "border-brand bg-brand text-white shadow-[0_3px_10px_rgba(79,70,229,.28)]"
                          : "border-line-2 bg-white text-muted hover:border-[#c7ccdf] hover:text-ink"
                      }`}
                    >
                      {preset.label.split(" · ")[1]}
                    </button>
                  );
                })}
              </div>
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
              Progress <span className="text-ink">{progress}%</span>
            </label>
            <input
              id="progress"
              name="progress"
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              style={{ ["--fill" as string]: `${progress}%` }}
              className="range"
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
