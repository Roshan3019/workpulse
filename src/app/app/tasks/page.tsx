import { redirect } from "next/navigation";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { DeleteTaskButton } from "@/components/tasks/DeleteTaskButton";
import { Avatar, Badge, EmptyState, ProgressBar } from "@/components/ui";
import { getStore } from "@/lib/data";
import { countdownLabel, dueDateOf, dueLabel } from "@/lib/dates";
import { requireSession } from "@/lib/session";
import { STATUS_LABEL, isAdminRole, type TaskPriority } from "@/lib/types";

export const metadata = { title: "All tasks" };
export const dynamic = "force-dynamic";

const PRIORITY_TONE: Record<TaskPriority, "red" | "amber" | "green"> = {
  high: "red",
  medium: "amber",
  low: "green",
};

const STATUS_TONE = {
  pending: "grey",
  in_progress: "indigo",
  done: "green",
} as const;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; assignee?: string }>;
}) {
  const session = await requireSession();
  if (!isAdminRole(session.membership.role)) redirect("/app/my-tasks");

  const params = await searchParams;
  const store = getStore();
  const orgId = session.organization.id;

  const members = await store.listMembers(orgId);
  const allTasks = await store.listTasks(orgId);
  const filtered = await store.listTasks(orgId, {
    search: params.q,
    status: params.status,
    assigneeId: params.assignee && params.assignee !== "all" ? params.assignee : undefined,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">All tasks</h1>
          <p className="lede">
            {filtered.length} of {allTasks.length} shown
          </p>
        </div>
        <TaskDialog members={members} />
      </div>

      <form method="get" className="card flex flex-wrap gap-2.5 p-3.5">
        <label className="flex min-w-[220px] flex-1 items-center gap-2.5 rounded-full border border-line-2 bg-white px-4 py-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-faint">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search task or client…"
            className="w-full bg-transparent text-sm outline-none"
            aria-label="Search tasks"
          />
        </label>
        <select name="status" defaultValue={params.status ?? "all"} className="rounded-full border border-line-2 bg-white px-4 py-2.5 text-sm font-semibold text-ink-2 outline-none">
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
        <select name="assignee" defaultValue={params.assignee ?? "all"} className="rounded-full border border-line-2 bg-white px-4 py-2.5 text-sm font-semibold text-ink-2 outline-none">
          <option value="all">All freelancers</option>
          {members
            .filter((m) => m.role === "member")
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.profile.fullName ?? m.profile.email}
              </option>
            ))}
        </select>
        <button type="submit" className="btn-primary btn-sm px-5">
          Filter
        </button>
      </form>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState title="No tasks match" hint="Try a different search, status or assignee." icon="🔍" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => {
            const assignee = members.find((m) => m.userId === task.assigneeId);
            const overdue =
              Boolean(task.deadline) &&
              task.status !== "done" &&
              dueDateOf(task.deadline!, task.dueTime).getTime() < Date.now();
            return (
              <article key={task.id} className="card grid gap-3 p-4 sm:p-5 lg:grid-cols-[1.5fr_1fr_1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>
                    <span className="text-[12.5px] font-semibold text-muted">{task.client || "No client"}</span>
                  </div>
                  <h2 className="mt-1.5 text-[16.5px] font-extrabold">{task.title}</h2>
                  {task.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed break-words text-muted">
                      {task.description}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-2.5">
                  {assignee ? (
                    <>
                      <Avatar id={assignee.userId} name={assignee.profile.fullName} email={assignee.profile.email} size={30} />
                      <span className="truncate text-[13.5px] font-semibold">{assignee.profile.fullName ?? "Unnamed"}</span>
                    </>
                  ) : (
                    <span className="text-[13px] text-faint">Unassigned</span>
                  )}
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-[12px] text-muted">
                    <span className="font-semibold text-ink-2">{task.progress}%</span>
                    <span>{task.estHours}h</span>
                  </div>
                  <ProgressBar value={task.progress} />
                  {assignee ? (
                    <div className="mt-1 truncate text-[11.5px] text-faint">capacity {assignee.capacity}h/wk</div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
                  {task.deadline ? (
                    <Badge tone={task.status === "done" ? "green" : overdue ? "red" : "grey"}>
                      {dueLabel(task.deadline, task.dueTime)}
                      {task.status !== "done" ? ` · ${countdownLabel(task.deadline, task.dueTime)}` : ""}
                    </Badge>
                  ) : null}
                  <TaskDialog members={members} task={task} variant="icon" />
                  <DeleteTaskButton taskId={task.id} title={task.title} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
