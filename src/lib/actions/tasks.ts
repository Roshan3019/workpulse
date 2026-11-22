"use server";

import { revalidatePath } from "next/cache";
import { getStore } from "../data";
import { requireAdmin, requireSession } from "../session";
import { memberProgressSchema, taskSchema } from "../validation";
import { isAdminRole, type Task } from "../types";

export type ActionResult = { error?: string; ok?: boolean };

function refresh() {
  revalidatePath("/app");
  revalidatePath("/app/tasks");
  revalidatePath("/app/my-tasks");
  revalidatePath("/app/team");
  revalidatePath("/app/availability");
}

export async function saveTaskAction(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const store = getStore();

  const payload = {
    title: formData.get("title"),
    client: formData.get("client") ?? "",
    description: formData.get("description") ?? "",
    assigneeId: formData.get("assigneeId"),
    estHours: formData.get("estHours"),
    progress: formData.get("progress") ?? 0,
    status: formData.get("status") ?? "pending",
    priority: formData.get("priority") ?? "medium",
    deadline: (formData.get("deadline") as string) || null,
  };

  const parsed = taskSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the task details" };
  }

  // Assignee must belong to this organization (defence in depth; RLS also guards).
  const members = await store.listMembers(session.organization.id);
  if (!members.some((m) => m.userId === parsed.data.assigneeId)) {
    return { error: "That person is not part of your team" };
  }

  const id = String(formData.get("id") ?? "");
  try {
    if (id) {
      await store.updateTask(session.organization.id, id, {
        title: parsed.data.title,
        client: parsed.data.client,
        description: parsed.data.description ?? "",
        assigneeId: parsed.data.assigneeId,
        estHours: parsed.data.estHours,
        progress: parsed.data.progress,
        status: parsed.data.status,
        priority: parsed.data.priority,
        deadline: parsed.data.deadline ?? null,
      });
    } else {
      await store.createTask(
        session.organization.id,
        {
          title: parsed.data.title,
          client: parsed.data.client,
          description: parsed.data.description || null,
          assigneeId: parsed.data.assigneeId,
          estHours: parsed.data.estHours,
          progress: parsed.data.progress,
          status: parsed.data.status,
          priority: parsed.data.priority,
          deadline: parsed.data.deadline ?? null,
        },
        session.user.id,
      );
    }
  } catch (error) {
    return { error: (error as Error).message };
  }

  refresh();
  return { ok: true };
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
