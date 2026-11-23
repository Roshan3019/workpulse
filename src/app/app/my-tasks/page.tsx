import Link from "next/link";
import { redirect } from "next/navigation";
import { MemberTaskCard } from "@/components/tasks/MemberTaskCard";
import { Badge, EmptyState } from "@/components/ui";
import { getStore } from "@/lib/data";
import { nextDatesIn } from "@/lib/dates";
import { getUserTimeZone, requireSession } from "@/lib/session";
import { isAdminRole } from "@/lib/types";
import { countStates } from "@/lib/availability";

export const metadata = { title: "My tasks" };
export const dynamic = "force-dynamic";

export default async function MyTasksPage() {
  const session = await requireSession();
  if (isAdminRole(session.membership.role)) redirect("/app");

  const store = getStore();
  const orgId = session.organization.id;

  // The task list and the timezone cookie are unrelated, so fetch together.
  const [tasks, tz] = await Promise.all([
    store.listTasks(orgId, { onlyForUser: session.membership.userId }),
    getUserTimeZone(),
  ]);

  const active = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  const dates = nextDatesIn(7, tz);
  const availability = await store.getAvailabilityStates(orgId, [session.membership.userId], dates);
  const freeNext7 = dates.reduce(
    (sum, d) => sum + countStates(availability[session.membership.userId]?.[d] ?? {}).free,
    0,
  );
  const assignedHours = active.reduce((sum, t) => sum + Number(t.estHours), 0);
  const utilisation = session.membership.capacity
    ? Math.round((assignedHours / session.membership.capacity) * 100)
    : 0;

  const firstName = (session.user.fullName ?? session.user.email).split(" ")[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">Hi {firstName} 👋</h1>
          <p className="lede">
            {active.length} active task{active.length === 1 ? "" : "s"} on your plate.
          </p>
        </div>
        <Link href="/app/availability" className="btn-outline">
          Update my free hours
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="label">Assigned hours</div>
          <div className="mt-1.5 text-[24px] leading-none font-semibold tabular-nums">{assignedHours}h</div>
          <div className="mt-1 text-[12px] text-faint">of {session.membership.capacity}h capacity</div>
        </div>
        <div className="card p-4">
          <div className="label">Utilisation</div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[24px] leading-none font-semibold tabular-nums">{utilisation}%</span>
            <Badge tone={utilisation >= 100 ? "red" : utilisation >= 75 ? "amber" : "green"}>
              {utilisation >= 100 ? "Overloaded" : utilisation >= 75 ? "Busy" : "Available"}
            </Badge>
          </div>
          <div className="mt-1 text-[12px] text-faint">Keep it under 100% to stay sane</div>
        </div>
        <div className="card p-4">
          <div className="label">Free next 7 days</div>
          <div className="mt-1.5 text-[24px] leading-none font-semibold tabular-nums">{freeNext7}h</div>
          <div className="mt-1 text-[12px] text-faint">From your availability calendar</div>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="card">
          <EmptyState title="All clear" hint="No active tasks. Enjoy the breathing room." />
        </div>
      ) : (
        <div className="space-y-4">
          {active.map((task) => (
            <MemberTaskCard key={task.id} task={task} />
          ))}
        </div>
      )}

      {done.length ? (
        <details className="card p-5">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2">
            Completed ({done.length})
          </summary>
          <div className="mt-4 space-y-4">
            {done.map((task) => (
              <MemberTaskCard key={task.id} task={task} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
