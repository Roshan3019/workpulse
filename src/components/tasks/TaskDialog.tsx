"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Alert } from "@/components/ui/Modal";
import { saveTaskAction, type ActionResult } from "@/lib/actions/tasks";
import { assigneesOf, type Member, type Task, type Team } from "@/lib/types";
import { resolveTaskTeam, teamsForUser, STUDIO_WIDE } from "@/lib/task-teams";
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

  /*
   * Who is on this task, and which team it lands on.
   *
   * The team is not free choice: it is derived from the assignees, because a
   * task belongs to the team its people are in. The admin can still say "no
   * team" (studio-wide), and if they force a team that one of the picked people
   * is not in, we say so instead of saving a contradiction.
   */
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() => assigneesOf(task ?? { assigneeId: null }));
  /*
   * `null` = "nobody has decided yet, follow the people"; STUDIO_WIDE = a
   * deliberate studio-wide task; any other id = a deliberate team.
   */
  const [teamChoice, setTeamChoice] = useState<string | null>(task?.teamId ?? null);

  /*
   * The team a task gets is decided by who is on it: pick one person from Team 1
   * and the Team field shows Team 1 by itself. An explicit choice — a team, or
   * "no team" — wins, and when that choice puts somebody outside the team they
   * are in, the field says so instead of saving a silent contradiction.
   */
  const team = useMemo(
    () => resolveTaskTeam(teams, assigneeIds, teamChoice),
    [teams, assigneeIds, teamChoice],
  );
  const autoTeam = useMemo(() => {
    if (!assigneeIds.length) return null;
    const ids = new Set(assigneeIds.flatMap((id) => teamsForUser(teams, id).map((t) => t.id)));
    return ids.size === 1 ? [...ids][0] : null;
  }, [assigneeIds, teams]);
  const effectiveTeam = teamChoice ?? autoTeam;
  const selectedTeam = teamChoice && teamChoice !== STUDIO_WIDE ? teamChoice : null;
  const teamMismatch =
    Boolean(selectedTeam) &&
    assigneeIds.some((id) => !teamsForUser(teams, id).some((t) => t.id === selectedTeam));

  useEffect(() => {
    if (!open) return;
    setAssigneeIds(assigneesOf(task ?? { assigneeId: null }));
    setTeamChoice(task?.teamId ?? null);
  }, [open, task]);

  function toggleAssignee(userId: string) {
    setAssigneeIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
    setTeamChoice(null); // let the derived team take over again
  }

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
          className={triggerClassName ?? "grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-[#f8f6f3] hover:text-ink"}
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

          <div className="field">
            <label htmlFor="client">Client *</label>
            <input id="client" name="client" required maxLength={120} defaultValue={task?.client} placeholder="e.g. Qween" />
          </div>

          {/* ---- who is on it: pick one, or several ---- */}
          <div>
            <label className="mb-1.5 block">
              Assign to *
              {assigneeIds.length > 1 ? (
                <span className="ml-1.5 font-medium text-muted">{assigneeIds.length} people</span>
              ) : null}
            </label>
            {/* The chosen people, in the order picked — the first is the lead. */}
            {assigneeIds.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {assigneeIds.map((id, index) => {
                  const m = members.find((x) => x.userId === id);
                  if (!m) return null;
                  const name = m.profile.fullName ?? m.profile.email;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-brand-line bg-brand-soft py-1 pr-1 pl-2 text-[12px] font-medium text-brand-dark"
                    >
                      {index === 0 ? <span className="text-[10px] tracking-[.06em] uppercase opacity-70">Lead</span> : null}
                      {name}
                      <button
                        type="button"
                        onClick={() => {
                          setAssigneeIds((prev) => prev.filter((x) => x !== id));
                          setTeamChoice(null);
                        }}
                        aria-label={`Remove ${name}`}
                        className="grid h-4 w-4 place-items-center rounded-full text-brand-dark/60 transition hover:bg-white/70 hover:text-brand-dark"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}

            <div className="max-h-48 overflow-y-auto rounded-lg border border-line p-1">
              {members
                .filter((m) => m.role === "member" || assigneeIds.includes(m.userId))
                .map((m) => {
                  const checked = assigneeIds.includes(m.userId);
                  const name = m.profile.fullName ?? m.profile.email;
                  const team = teamsForUser(teams, m.userId)[0];
                  return (
                    <label
                      key={m.userId}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors ${
                        checked ? "bg-[#faf7f3]" : "hover:bg-[#f8f6f3]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAssignee(m.userId)}
                        className="h-3.5 w-3.5 accent-[var(--color-brand)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{name}</span>
                      {team ? (
                        <span className="shrink-0 rounded-md bg-[#f4f1ec] px-1.5 py-0.5 text-[10.5px] font-medium text-muted">
                          {team.name}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10.5px] text-faint">no team</span>
                      )}
                    </label>
                  );
                })}
            </div>
            <p className="mt-1 text-[11.5px] text-faint">
              Tick more than one person to share the task. The first one you pick is the lead.
            </p>
            {/* Posted to the server: one field per person, in order. */}
            {assigneeIds.map((id) => (
              <input key={id} type="hidden" name="assigneeIds" value={id} />
            ))}
          </div>

          {teams.length ? (
            <div className="field">
              <label htmlFor="teamId">
                Team
                {autoTeam ? (
                  <span className="ml-1.5 font-medium text-ok-dark">
                    set from the people you picked
                  </span>
                ) : null}
              </label>
              <select
                id="teamId"
                name="teamId"
                value={effectiveTeam ?? "none"}
                onChange={(event) =>
                  setTeamChoice(event.target.value === "none" ? STUDIO_WIDE : event.target.value)
                }
              >
                <option value="none">No team (studio-wide)</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              {/*
                The objection the client asked for: somebody on this task is not
                in the team you forced. Saving is still allowed — it is a
                deliberate cross-team choice — but it is never silent.
              */}
              {teamMismatch || team.warning ? (
                <p className="mt-1.5 rounded-lg border border-[#f0dcbb] bg-[#fdf6ea] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-[#8a5a13]">
                  {team.warning ??
                    "Someone you picked is not in this team, so the task will only appear under it."}
                </p>
              ) : null}
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
          <div className="rounded-xl border border-line bg-[#fbfaf8] p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <span className="label !mb-0">Timing</span>
              {timingSummary ? (
                <span className="rounded-md border border-brand-line bg-white px-2 py-0.5 text-[11.5px] font-semibold text-brand-dark">
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
                <span className="w-14 shrink-0 text-[10.5px] font-medium tracking-[.06em] text-faint uppercase">
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
                      className={`chip h-8 rounded-[8px] border px-2.5 text-[12px] font-medium transition ${
                        active
                          ? "border-brand bg-brand text-white"
                          : "border-line-2 bg-white text-muted hover:border-[#c9c2b6] hover:text-ink"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-14 shrink-0 text-[10.5px] font-medium tracking-[.06em] text-faint uppercase">
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
                      className={`chip h-8 rounded-[8px] border px-2.5 text-[12px] font-medium transition ${
                        active
                          ? "border-brand bg-brand text-white"
                          : "border-line-2 bg-white text-muted hover:border-[#c9c2b6] hover:text-ink"
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
          {!state?.error && state?.message ? (
            <p className="rounded-lg border border-[#f0dcbb] bg-[#fdf6ea] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-[#8a5a13]">
              {state.message}
            </p>
          ) : null}

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
