import Link from "next/link";
import { redirect } from "next/navigation";
import { OverallSlots } from "@/components/dashboard/OverallSlots";
import { WorkloadList } from "@/components/dashboard/WorkloadList";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { EmptyState, Section } from "@/components/ui";
import { getStore } from "@/lib/data";
import { orgMembers } from "@/lib/data/request-cache";
import { countdownLabel, dueDateOf, dueLabel, nextDatesIn } from "@/lib/dates";
import { getUserTimeZone, requireSession } from "@/lib/session";
import { isAdminRole } from "@/lib/types";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  pending: "pill-grey",
  in_progress: "pill-indigo",
  done: "pill-green",
} as const;

export default async function DashboardPage() {
  const session = await requireSession();
  if (!isAdminRole(session.membership.role)) redirect("/app/my-tasks");

  const store = getStore();
  const orgId = session.organization.id;
  const [members, tasks, tz] = await Promise.all([
    orgMembers(orgId),
    store.listTasks(orgId),
    getUserTimeZone(),
  ]);

  const freelancers = members.filter((m) => m.role === "member");
  const openTasks = tasks.filter((t) => t.status !== "done");
  const totalHours = openTasks.reduce((sum, t) => sum + Number(t.estHours), 0);
  const doneCount = tasks.filter((t) => t.status === "done").length;

  const dates = nextDatesIn(7, tz);
  const availability = await store.getAvailability(
    orgId,
    freelancers.map((m) => m.userId),
    dates,
  );

  // Sorted by the real due moment (date + time), not just the date string.
  const upcoming = [...openTasks]
    .filter((t) => t.deadline)
    .sort(
      (a, b) =>
        dueDateOf(a.deadline!, a.dueTime).getTime() - dueDateOf(b.deadline!, b.dueTime).getTime(),
    )
    .slice(0, 5);

  const icon = (paths: React.ReactNode) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  );

  const stats = [
    {
      label: "Freelancers",
      value: freelancers.length,
      note: "Members on the team",
      tint: "bg-brand-soft text-brand",
      icon: icon(
        <>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        </>,
      ),
    },
    {
      label: "Active tasks",
      value: openTasks.length,
      note: "Pending + in progress",
      tint: "bg-ok-soft text-ok-dark",
      icon: icon(
        <>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
        </>,
      ),
    },
    {
      label: "Est. hours",
      value: Math.round(totalHours),
      note: "Across active tasks",
      tint: "bg-warn-soft text-warn-dark",
      icon: icon(
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </>,
      ),
    },
    {
      label: "Completed",
      value: doneCount,
      note: "All time",
      tint: "bg-[#f1f3f9] text-ink-2",
      icon: icon(
        <>
          <path d="M20 6 9 17l-5-5" />
        </>,
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">Team pulse, right now</h1>
          <p className="lede">Who&apos;s free, who&apos;s slammed, and what&apos;s due next — at a glance.</p>
        </div>
        <TaskDialog members={members} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <span className={`grid h-9 w-9 place-items-center rounded-xl ${stat.tint}`}>{stat.icon}</span>
              <span className="label">{stat.label}</span>
            </div>
            <div className="mt-3 text-[28px] leading-none font-extrabold tracking-[-0.02em]">{stat.value}</div>
            <div className="mt-1.5 text-[12px] text-faint">{stat.note}</div>
          </div>
        ))}
      </div>

      <WorkloadList members={freelancers} tasks={tasks} />

      <OverallSlots members={freelancers} availability={availability} dates={dates} />

      <Section
        title="Next deadlines"
        subtitle="The five closest open tasks"
        action={
          <Link href="/app/tasks" className="btn-outline btn-sm">
            All tasks
          </Link>
        }
      >
        {upcoming.length === 0 ? (
          <EmptyState title="Nothing due" hint="Assign a task and it will show up here." icon="🎉" />
        ) : (
          <ul className="divide-y divide-[#f0f1f7]">
            {upcoming.map((task) => {
              const assignee = members.find((m) => m.userId === task.assigneeId);
              const overdue = dueDateOf(task.deadline!, task.dueTime).getTime() < Date.now();
              return (
                <li key={task.id} className="flex flex-wrap items-center gap-2 py-3 text-[13.5px]">
                  <span className="font-bold">{task.title}</span>
                  <span className="text-muted">· {task.client}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-muted">{assignee?.profile.fullName ?? "Unassigned"}</span>
                    <span className={`pill ${STATUS_TONE[task.status]}`}>{task.status.replace("_", " ")}</span>
                    <span className={`pill ${overdue ? "pill-red" : "pill-grey"}`}>
                      {dueLabel(task.deadline!, task.dueTime)} · {countdownLabel(task.deadline!, task.dueTime)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
