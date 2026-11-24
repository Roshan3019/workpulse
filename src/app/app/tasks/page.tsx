import { redirect } from "next/navigation";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { DeleteTaskButton } from "@/components/tasks/DeleteTaskButton";
import { Avatar, Badge, EmptyState, ProgressBar } from "@/components/ui";
import { getStore } from "@/lib/data";
import { orgMembers } from "@/lib/data/request-cache";
import { countdownLabel, dueDateOf, dueLabel } from "@/lib/dates";
import { requireSession } from "@/lib/session";
import { STATUS_LABEL, assigneesOf, isAdminRole, type TaskPriority } from "@/lib/types";
import { displayName } from "@/lib/format";

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
  searchParams: Promise<{ q?: string; status?: string; assignee?: string; team?: string }>;
}) {
  const session = await requireSession();
  if (!isAdminRole(session.membership.role)) redirect("/app/my-tasks");

  const params = await searchParams;
  const store = getStore();
  const orgId = session.organization.id;

  /*
   * Fetch the org's tasks once and filter in memory.
   *
   * This page used to run three queries — members, all tasks, and filtered
   * tasks — and two of them returned the same rows. Org task counts are small
   * (hundreds), so a single query plus a pure filter is dramatically cheaper
   * than two more round trips across the network.
   */
  const [members, allTasks, teams] = await Promise.all([
    orgMembers(orgId),
    store.listTasks(orgId),
    store.listTeams(orgId),
  ]);
  const team = params.team && params.team !== "all" ? teams.find((t) => t.slug === params.team) ?? null : null;
  const search = params.q?.trim().toLowerCase();
  const status = params.status && params.status !== "all" ? params.status : undefined;
  const assigneeId = params.assignee && params.assignee !== "all" ? params.assignee : undefined;
  const filtered = allTasks.filter(
    (t) =>
      (!team || t.teamId === team.id) &&
      (!assigneeId || assigneesOf(t).includes(assigneeId)) &&
      (!status || t.status === status) &&
      (!search ||
        t.title.toLowerCase().includes(search) ||
        (t.client ?? "").toLowerCase().includes(search)),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">All tasks</h1>
          <p className="lede">
            {filtered.length} of {allTasks.length} shown
          </p>
        </div>
        <TaskDialog members={members} teams={teams} />
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
                {displayName(m.profile.fullName)}
              </option>
            ))}
        </select>
        {teams.length ? (
          <select name="team" defaultValue={params.team ?? "all"} className="rounded-full border border-line-2 bg-white px-4 py-2.5 text-sm font-semibold text-ink-2 outline-none">
            <option value="all">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        ) : null}
        <button type="submit" className="btn-primary btn-sm px-5">
          Filter
        </button>
      </form>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState title="No tasks match" hint="Try a different search, status or assignee." />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => {
            /*
             * A task can be shared. Show everyone on it — the old single
             * avatar is why a two-person task looked like one person's job.
             */
            const assigned = assigneesOf(task)
              .map((id) => members.find((m) => m.userId === id))
              .filter((m): m is NonNullable<typeof m> => Boolean(m));
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
                    {(() => {
                      const owner = teams.find((t) => t.id === task.teamId);
                      return owner ? (
                        <span className="rounded-md bg-[#f4f5fa] px-1.5 py-0.5 text-[11px] font-medium text-muted">
                          {owner.name}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <h2 className="mt-1.5 text-[16.5px] font-semibold">{task.title}</h2>
                  {task.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed break-words text-muted">
                      {task.description}
                    </p>
                  ) : null}
                </div>

                <div className="flex min-w-0 items-center gap-2">
                  {assigned.length ? (
                    <>
                      <div className="flex shrink-0 -space-x-1.5">
                        {assigned.slice(0, 3).map((m) => (
                          <span key={m.userId} className="ring-2 ring-white rounded-full">
                            <Avatar id={m.userId} name={m.profile.fullName} email={m.profile.email} size={28} />
                          </span>
                        ))}
                      </div>
                      <span className="min-w-0 truncate text-[13px] font-semibold">
                        {assigned.length === 1
                          ? (assigned[0].profile.fullName ?? "Unnamed")
                          : `${assigned[0].profile.fullName ?? "Unnamed"} +${assigned.length - 1}`}
                      </span>
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
                  {assigned.length === 1 ? (
                    <div className="mt-1 truncate text-[11.5px] text-faint">capacity {assigned[0].capacity}h/wk</div>
                  ) : assigned.length > 1 ? (
                    <div className="mt-1 truncate text-[11.5px] text-faint">
                      shared by {assigned.length} · {task.estHours}h total
                    </div>
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
                  <TaskDialog members={members} teams={teams} task={task} variant="icon" />
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
