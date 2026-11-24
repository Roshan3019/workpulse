"use server";

import { revalidatePath } from "next/cache";
import { getStore } from "../data";
import { requireAdmin, requireSession } from "../session";
import { memberProgressSchema, taskSchema, teamSchema } from "../validation";
import { assigneesOf, isAdminRole, type Task } from "../types";
import { resolveTaskTeam, STUDIO_WIDE } from "../task-teams";

export type ActionResult = { error?: string; ok?: boolean; message?: string };

/*
 * Every page that renders a task has to be refreshed, and three of them are
 * separate routes with their own caches. Doing this once, in a list, is what
 * makes a newly assigned task appear on the dashboard *and* the team view in
 * the same round trip — the bug the client hit was a task that "didn't reflect
 * on the team".
 */
const TASK_PATHS = [
  "/app",
  "/app/tasks",
  "/app/my-tasks",
  "/app/team",
  "/app/teams",
  "/app/availability",
  "/app/settings",
];

function refresh() {
  for (const path of TASK_PATHS) revalidatePath(path);
}

export async function saveTaskAction(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const store = getStore();
  const orgId = session.organization.id;

  /*
   * Assignees arrive as repeated `assigneeIds` fields (one per ticked person).
   * The single `assigneeId` field is still honoured so an older tab, or a form
   * that only knows about one person, keeps working.
   */
  const posted = formData
    .getAll("assigneeIds")
    .map(String)
    .filter(Boolean);
  const single = formData.get("assigneeId");
  const rawAssigneeIds = posted.length ? posted : single ? [String(single)] : [];

  const payload = {
    title: formData.get("title"),
    client: formData.get("client") ?? "",
    description: formData.get("description") ?? "",
    assigneeIds: [...new Set(rawAssigneeIds)],
    estHours: formData.get("estHours"),
    progress: formData.get("progress") ?? 0,
    status: formData.get("status") ?? "pending",
    priority: formData.get("priority") ?? "medium",
    deadline: (formData.get("deadline") as string) || null,
    startDate: (formData.get("startDate") as string) || null,
    dueTime: (formData.get("dueTime") as string) || null,
    /*
     * Passed through untouched: "" means "nobody chose a team, work it out
     * from the assignees". (This line used to coerce "" to "none", which made
     * every task studio-wide — the reason a team's task list stayed empty.)
     */
    teamId: (formData.get("teamId") as string | null) ?? "",
  };

  const parsed = taskSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the task details" };
  }

  const assigneeIds = parsed.data.assigneeIds ?? [];
  if (!assigneeIds.length) return { error: "Pick at least one person to assign this to" };

  // Every assignee must belong to this studio (defence in depth; RLS also guards).
  const members = await store.listMembers(orgId);
  const memberIds = new Set(members.map((m) => m.userId));
  const stranger = assigneeIds.find((id) => !memberIds.has(id));
  if (stranger) return { error: "That person is not part of your team" };

  /*
   * The team is derived from the assignees, never taken on trust.
   *
   * This is also why the client's task "didn't reflect on the team": the dialog
   * posted `teamId` and the action never read it, so every new task was saved
   * studio-wide and no team view could show it.
   */
  const teams = await store.listTeams(orgId);
  /*
   * "none" is a decision (studio-wide), "" is no decision at all (derive the
   * team from the people). Collapsing both to null is what made an explicit
   * studio-wide task quietly jump into a team.
   */
  const postedTeam = parsed.data.teamId;
  const derive = !postedTeam;
  const chosen =
    postedTeam === STUDIO_WIDE || postedTeam === "none" ? STUDIO_WIDE : (postedTeam ?? null);
  if (!derive && chosen !== STUDIO_WIDE && !teams.some((t) => t.id === chosen)) {
    return { error: "That team belongs to a different studio" };
  }
  const teamChoice = resolveTaskTeam(teams, assigneeIds, derive ? null : chosen);

  const patch = {
    title: parsed.data.title,
    client: parsed.data.client,
    description: parsed.data.description ?? "",
    assigneeId: assigneeIds[0],
    assigneeIds,
    estHours: parsed.data.estHours,
    progress: parsed.data.progress,
    status: parsed.data.status,
    priority: parsed.data.priority,
    deadline: parsed.data.deadline ?? null,
    startDate: parsed.data.startDate ?? null,
    dueTime: parsed.data.dueTime ?? null,
    teamId: teamChoice.teamId,
  };

  const id = String(formData.get("id") ?? "");
  try {
    if (id) {
      await store.updateTask(orgId, id, patch);
    } else {
      await store.createTask(
        orgId,
        { ...patch, description: parsed.data.description || null },
        session.user.id,
      );
    }
  } catch (error) {
    return { error: (error as Error).message };
  }

  refresh();
  /*
   * The dialog closes on `ok`, so a warning still has to travel back to the
   * person who caused it. Admins get the "only under Team 2" note here.
   */
  return { ok: true, message: teamChoice.warning ?? undefined };
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  try {
    await getStore().deleteTask(session.organization.id, taskId);
  } catch (error) {
    return { error: (error as Error).message };
  }
  refresh();
  return { ok: true };
}

/** Members update their own progress / status. */
export async function updateProgressAction(input: {
  taskId: string;
  progress: number;
  status: string;
}): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = memberProgressSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid progress value" };

  const store = getStore();
  const tasks = await store.listTasks(session.organization.id, {
    onlyForUser: session.membership.userId,
  });
  const task = tasks.find((t) => t.id === parsed.data.taskId);
  if (!task) return { error: "Task not found" };

  try {
    await store.updateTask(session.organization.id, parsed.data.taskId, {
      progress: parsed.data.status === "done" ? 100 : parsed.data.progress,
      status: parsed.data.status,
    });
  } catch (error) {
    return { error: (error as Error).message };
  }
  refresh();
  return { ok: true };
}

/** Admins can also nudge progress/status inline from the task list. */
export async function adminSetStatusAction(taskId: string, status: Task["status"]): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!isAdminRole(session.membership.role)) return { error: "Not allowed" };
  try {
    await getStore().updateTask(session.organization.id, taskId, {
      status,
      ...(status === "done" ? { progress: 100 } : {}),
    });
  } catch (error) {
    return { error: (error as Error).message };
  }
  refresh();
  return { ok: true };
}

/* --------------------------------- teams --------------------------------- */

export async function saveTeamAction(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const store = getStore();

  const parsed = teamSchema.safeParse({
    name: formData.get("name"),
    memberIds: formData.getAll("memberIds").map(String).filter(Boolean),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the team details" };

  const orgId = session.organization.id;
  const members = await store.listMembers(orgId);
  // Only people from this studio, and only freelancers can sit in a team.
  const allowed = new Set(members.filter((m) => m.role === "member").map((m) => m.userId));
  const memberIds = parsed.data.memberIds.filter((id) => allowed.has(id));

  const id = String(formData.get("id") ?? "");
  try {
    if (id) {
      await store.updateTeam(orgId, id, { name: parsed.data.name });
      await store.setTeamMembers(orgId, id, memberIds);
    } else {
      await store.createTeam(orgId, parsed.data.name, memberIds);
    }
    /*
     * Moving somebody between teams changes which tasks belong to which team.
     * Re-settling the affected tasks here keeps the two views in agreement —
     * otherwise a task could keep pointing at a team its assignee just left.
     */
    await settleTasksAfterTeamChange(orgId, memberIds, parsed.data.memberIds);
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath("/app/teams");
  refresh();
  return { ok: true };
}

/**
 * After a team's roster changes, re-derive `teamId` for tasks assigned to the
 * people involved. Tasks the admin placed on a team explicitly are left alone
 * (the assign dialog warns about those); this only fixes tasks whose team no
 * longer contains anybody on them.
 */
async function settleTasksAfterTeamChange(orgId: string, memberIds: string[], touched: string[]) {
  const store = getStore();
  const teams = await store.listTeams(orgId);
  const people = new Set([...memberIds, ...touched]);
  if (!people.size) return;

  const tasks = await store.listTasks(orgId);
  for (const task of tasks) {
    const assignees = assigneesOf(task);
    if (!assignees.some((id) => people.has(id))) continue;
    if (task.teamId && teams.some((t) => t.id === task.teamId && assignees.some((id) => t.memberIds.includes(id)))) {
      continue;
    }
    const choice = resolveTaskTeam(teams, assignees, null);
    if (choice.teamId !== task.teamId) {
      await store.updateTask(orgId, task.id, { teamId: choice.teamId });
    }
  }
}

export async function deleteTeamAction(teamId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  try {
    await getStore().deleteTeam(session.organization.id, teamId);
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app/teams");
  refresh();
  return { ok: true };
}
