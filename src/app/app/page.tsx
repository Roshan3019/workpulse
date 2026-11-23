import Link from "next/link";
import { redirect } from "next/navigation";
import { OverallSlots } from "@/components/dashboard/OverallSlots";
import { TeamSlotGrid } from "@/components/dashboard/TeamSlotGrid";
import { TeamSwitcher } from "@/components/dashboard/TeamSwitcher";
import { JoinRequestInbox } from "@/components/team/JoinRequestInbox";
import { WorkloadList } from "@/components/dashboard/WorkloadList";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { EmptyState, Section } from "@/components/ui";
import { getStore } from "@/lib/data";
import { orgMembers } from "@/lib/data/request-cache";
import { countdownLabel, dueDateOf, dueLabel, nextDatesIn } from "@/lib/dates";
import { getUserTimeZone, requireSession } from "@/lib/session";
import { isAdminRole } from "@/lib/types";
import { foldWeeklyDefaults, hoursFromStates } from "@/lib/availability";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  pending: "pill-grey",
  in_progress: "pill-indigo",
  done: "pill-green",
} as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; day?: string }>;
}) {
  const session = await requireSession();
  if (!isAdminRole(session.membership.role)) redirect("/app/my-tasks");

  const store = getStore();
  const orgId = session.organization.id;
  const [members, allTasks, tz, teams, joinRequests, params] = await Promise.all([
    orgMembers(orgId),
    store.listTasks(orgId),
    getUserTimeZone(),
    store.listTeams(orgId),
    store.listJoinRequests(orgId),
    searchParams,
  ]);

  /*
   * The switcher is a query param, so "Overall" and each team are separate,
   * linkable views. An unknown slug falls back to Overall rather than 404ing.
   */
  const selectedTeam = teams.find((t) => t.slug === params.team) ?? null;
  const tasks = selectedTeam ? allTasks.filter((t) => t.teamId === selectedTeam.id) : allTasks;

  const teamMembership = new Set(selectedTeam?.memberIds ?? []);
  const freelancers = members.filter(
    (m) => m.role === "member" && (!selectedTeam || teamMembership.has(m.userId)),
  );
  const openTasks = tasks.filter((t) => t.status !== "done");
  const totalHours = openTasks.reduce((sum, t) => sum + Number(t.estHours), 0);
  const doneCount = tasks.filter((t) => t.status === "done").length;

  const dates = nextDatesIn(7, tz);
  const memberIds = freelancers.map((m) => m.userId);
  const [storedAvailability, weeklyDefaults] = await Promise.all([
    store.getAvailabilityStates(orgId, memberIds, dates),
    store.listWeeklyDefaults(orgId, memberIds),
  ]);
  /*
   * A day nobody has painted still means "my usual Tuesday". Folding the
   * templates in here is what stops the team view from reading as a grey
   * wall while the members' own calendars look full.
   */
  const availability = foldWeeklyDefaults(weeklyDefaults, memberIds, dates, storedAvailability);

  /* The team-slot view shows one day; ?day= picks it, anything off-list is today. */
  const selectedDay = params.day && dates.includes(params.day) ? params.day : dates[0];

  // Legacy hour map for the widgets that still think in "free hours".
  const freeHours: Record<string, Record<string, number[]>> = Object.fromEntries(
    Object.entries(availability).map(([userId, days]) => [
      userId,
      Object.fromEntries(Object.entries(days).map(([date, states]) => [date, hoursFromStates(states)])),
    ]),
  );

  // Sorted by the real due moment (date + time), not just the date string.
  const upcoming = [...openTasks]
    .filter((t) => t.deadline)
    .sort(
      (a, b) =>
        dueDateOf(a.deadline!, a.dueTime).getTime() - dueDateOf(b.deadline!, b.dueTime).getTime(),
    )
    .slice(0, 5);

  const stats = [
    {
      label: "Freelancers",
      value: freelancers.length,
      note: selectedTeam ? `In ${selectedTeam.name}` : "On the team",
      tint: "bg-brand-soft text-brand",
      icon: (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        </>
      ),
    },
    {
      label: "Active tasks",
      value: openTasks.length,
      note: "Pending + in progress",
      tint: "bg-warn-soft text-warn-dark",
      icon: (
        <>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </>
      ),
    },
    {
      label: "Estimated hours",
      value: Math.round(totalHours),
      note: "Across active tasks",
      tint: "bg-[#eaf6fd] text-[#0369a1]",
      icon: (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </>
      ),
    },
    {
      label: "Completed",
      value: doneCount,
      note: "All time",
      tint: "bg-ok-soft text-ok-dark",
      icon: (
        <>
          <path d="M20 6 9 17l-5-5" />
        </>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">{selectedTeam ? selectedTeam.name : "Team pulse, right now"}</h1>
          <p className="lede">
            {selectedTeam
              ? `People, hours and deadlines in ${selectedTeam.name}.`
              : "Who's free, who's slammed, and what's due next, at a glance."}
          </p>
        </div>
        <TaskDialog members={members} teams={teams} />
      </div>

      {teams.length ? (
        <TeamSwitcher teams={teams} active={selectedTeam?.slug ?? null} />
      ) : null}

      {/* Only admins land on this page, so anyone waiting is theirs to approve. */}
      <JoinRequestInbox requests={joinRequests} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card flex flex-col p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${stat.tint}`}>
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {stat.icon}
                </svg>
              </span>
              <span className="label truncate">{stat.label}</span>
            </div>
            <div className="mt-3 text-[28px] leading-none font-extrabold tabular-nums tracking-[-0.02em]">
              {stat.value}
            </div>
            <div className="mt-1.5 truncate text-[12px] text-faint">{stat.note}</div>
          </div>
        ))}
      </div>

      <WorkloadList members={freelancers} tasks={tasks} />

      <OverallSlots members={freelancers} availability={freeHours} dates={dates} />

      {/* The client's ask: one day, every teammate, hour by hour. */}
      <div id="team-slots" className="scroll-mt-24">
        <TeamSlotGrid
          members={freelancers}
          availability={availability}
          date={selectedDay}
          dates={dates}
          today={dates[0]}
          current={selectedTeam?.slug ?? null}
          title={selectedTeam ? `${selectedTeam.name} slots` : "Team slots"}
        />
      </div>

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
          <EmptyState title="Nothing due" hint="Assign a task and it will show up here." />
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
