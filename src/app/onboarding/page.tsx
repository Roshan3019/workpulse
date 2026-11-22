import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Logo, LogoMark } from "@/components/ui";
import { Alert } from "@/components/ui/Modal";
import { createOrganizationAction } from "@/lib/actions/org";
import { getAuthContext } from "@/lib/session";
import { env } from "@/lib/env";
import { isAdminRole } from "@/lib/types";

export const metadata = { title: "Welcome to WorkPulse" };

const ADMIN_TOUR = [
  {
    icon: "⚖️",
    title: "Workload at a glance",
    body: "The dashboard shows every teammate's remaining hours against their weekly capacity, so you can spot who's free before you assign the next job.",
    href: "/app",
    cta: "Open dashboard",
  },
  {
    icon: "🎯",
    title: "Client tasks & deadlines",
    body: "Add a task with client, estimate, priority and deadline. Progress is a percentage, so partial work is visible instead of binary done/not-done.",
    href: "/app/tasks",
    cta: "Manage tasks",
  },
  {
    icon: "🗓️",
    title: "Overall time slots",
    body: "One heatmap of the whole team's free hours for the next 7 days, plus plain-English ranges like MON 9a–5p.",
    href: "/app/availability",
    cta: "See the heatmap",
  },
  {
    icon: "👥",
    title: "Invite your crew",
    body: "Send an invite link tied to an email address. Seats are enforced by your plan — free includes 5.",
    href: "/app/settings",
    cta: "Invite teammates",
  },
];

const MEMBER_TOUR = [
  {
    icon: "📋",
    title: "Your tasks",
    body: "Everything assigned to you, with client, estimate, priority and deadline. Update progress as you go — your admin sees it live.",
    href: "/app/my-tasks",
    cta: "Open my tasks",
  },
  {
    icon: "🖌️",
    title: "Paint your availability",
    body: "Pick a date and drag across the grid to mark the hours you're free. Works with mouse, touch and stylus.",
    href: "/app/availability",
    cta: "Set availability",
  },
];

export default async function OnboardingPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  // Signed in but no workspace yet → the real onboarding flow.
  if (!ctx.membership) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Logo />
        </div>

        <main className="mx-auto max-w-lg px-5 py-10">
          <div className="card p-6 sm:p-8">
            <p className="label">Step 1 of 1</p>
            <h1 className="mt-2 text-[26px] font-extrabold tracking-[-0.02em]">Name your workspace</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              This is your team&apos;s home in WorkPulse — you&apos;ll be the owner. You can rename it later.
            </p>

            <form
              action={async (formData: FormData) => {
                "use server";
                await createOrganizationAction(formData);
              }}
              className="mt-6 space-y-4"
            >
              <div className="field">
                <label htmlFor="name">Team or studio name</label>
                <input id="name" name="name" required placeholder="Northstar Studio" autoFocus />
              </div>
              <button type="submit" className="btn-primary w-full py-3">
                Create workspace
              </button>
            </form>

            {env.demoMode ? (
              <div className="mt-5">
                <Alert tone="info">
                  Demo mode — this creates a workspace in memory and resets when the server restarts.
                </Alert>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  // Signed in WITH a workspace → guided tour, not a dead end.
  const isAdmin = isAdminRole(ctx.membership.role);
  const tour = isAdmin ? ADMIN_TOUR : MEMBER_TOUR;
  const firstName = (ctx.user.fullName ?? ctx.user.email).split(/[\s@]/)[0];

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <Link href={isAdmin ? "/app" : "/app/my-tasks"} className="text-[13px] font-semibold text-muted hover:text-ink">
          Skip the tour →
        </Link>
      </div>

      <main className="mx-auto max-w-3xl px-5 py-6 sm:py-10">
        <Badge tone="indigo">You&apos;re in</Badge>
        <h1 className="mt-4 text-[30px] leading-tight font-extrabold tracking-[-0.02em] sm:text-[38px]">
          Welcome, {firstName}. Here&apos;s the 60-second tour.
        </h1>
        <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-muted">
          You&apos;re the <b>{ctx.membership.role}</b> of <b>{ctx.organization?.name}</b>. Four things worth knowing
          before your first Monday:
        </p>

        <div className="mt-8 grid gap-3.5 sm:grid-cols-2">
          {tour.map((item, i) => (
            <Link
              key={item.title}
              href={item.href}
              className="card group flex flex-col p-5 transition hover:border-brand-line hover:shadow-[0_6px_24px_rgba(79,70,229,.10)]"
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl">{item.icon}</span>
                <span className="text-[11px] font-bold tracking-wide text-faint">0{i + 1}</span>
              </div>
              <h2 className="mt-3 text-[15.5px] font-extrabold">{item.title}</h2>
              <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-muted">{item.body}</p>
              <span className="mt-3 text-[13px] font-bold text-brand group-hover:underline">{item.cta} →</span>
            </Link>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <LogoMark size={34} />
            <div>
              <div className="text-[13.5px] font-extrabold">Ready when you are</div>
              <div className="text-[12.5px] text-muted">
                {isAdmin ? "Start by adding one real task from this week." : "Start by painting this week's availability."}
              </div>
            </div>
          </div>
          <Link href={isAdmin ? "/app" : "/app/my-tasks"} className="btn-primary btn-sm w-full sm:w-auto">
            {isAdmin ? "Go to dashboard" : "Go to my tasks"}
          </Link>
        </div>
      </main>
    </div>
  );
}
