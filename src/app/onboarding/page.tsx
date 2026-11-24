import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Logo, LogoMark } from "@/components/ui";
import { Alert } from "@/components/ui/Modal";
import { createOrganizationAction } from "@/lib/actions/org";
import { getStore } from "@/lib/data";
import { getAuthContext } from "@/lib/session";
import { env } from "@/lib/env";
import { PLANS, isAdminRole } from "@/lib/types";

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
    body: `Send an invite link tied to an email address. Seats follow your plan; free includes ${PLANS.free.seats}.`,
    href: "/app/settings",
    cta: "Invite teammates",
  },
];

const MEMBER_TOUR = [
  {
    icon: "📋",
    title: "Your tasks",
    body: "Everything assigned to you, with client, estimate, priority and deadline. Update progress as you go and your admin sees it live.",
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

/**
 * Where the visitor came from decides what onboarding offers.
 *
 *   arriving through an invite or a join link → only ever the invited studio:
 *     wait for approval, or (once approved) land in it. Never "make your own".
 *   arriving on their own → their own studio, and only that.
 *
 * A query param records the route. It is a *hint*, not a security decision —
 * the database still decides what anyone can see — but it is what stops a
 * person who followed a link from being shown a create-a-studio form that has
 * nothing to do with why they are here.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ waiting?: string; via?: string; next?: string }>;
}) {
  const params = await searchParams;
  const viaLink = params.via === "invite" || params.via === "join" || params.waiting === "1";
  const ctx = await getAuthContext();
  if (!ctx) {
    const next = params.next ?? (viaLink ? "/onboarding?via=join" : "/onboarding");
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  /*
   * Waiting on a studio you already asked to join.
   *
   * This comes before "name your workspace": someone who used a join link has
   * already told us what they want, and asking them to create a studio is how
   * they end up as the owner of an empty workspace instead of a member of the
   * one that invited them.
   */
  const pendingRequests = ctx.membership ? [] : await getStore().listMyJoinRequests(ctx.user.id);
  if (!ctx.membership && pendingRequests.length > 0) {
    const first = pendingRequests[0];
    const sent = new Date(first.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });

    return (
      <div className="min-h-screen">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Logo />
        </div>

        <main className="mx-auto max-w-lg px-5 py-10">
          <div className="card p-6 sm:p-8">
            <Badge tone="amber">Waiting for approval</Badge>
            <h1 className="mt-3 text-[24px] font-semibold tracking-[-0.02em]">
              Your request to join {first.orgName} is with their admin
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              You asked on {sent}. Nothing else is needed from you — the moment an admin approves it,
              signing in puts you straight into {first.orgName}.
            </p>

            {first.note ? (
              <p className="mt-4 border-l-2 border-line-2 pl-3 text-[12.5px] leading-relaxed text-ink-2 italic">
                “{first.note}”
              </p>
            ) : null}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link href="/app" className="btn-primary flex-1 py-2.5 text-center">
                Check again
              </Link>
              <Link href="/" className="btn-outline flex-1 py-2.5 text-center">
                Back to site
              </Link>
            </div>

            {pendingRequests.length > 1 ? (
              <p className="mt-4 border-t border-line pt-4 text-[12px] leading-relaxed text-muted">
                Also waiting on{" "}
                {pendingRequests
                  .slice(1)
                  .map((r) => r.orgName)
                  .join(", ")}
                .
              </p>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  /*
   * Came here from a link, but has no studio to show for it.
   *
   * Either the request is still with an admin (handled above), it was declined,
   * or the invite was used already. In all three cases the answer is *not*
   * "start your own studio" — that produces exactly the account that then owns
   * an empty workspace and wonders why it never got into the one that invited
   * it. Send them back to the link, or explain the wait.
   */
  if (!ctx.membership && viaLink) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Logo />
        </div>
        <main className="mx-auto max-w-lg px-5 py-10">
          <div className="card p-6 sm:p-8">
            <Badge tone="amber">Nothing to do yet</Badge>
            <h1 className="mt-3 text-[24px] font-semibold tracking-[-0.02em]">
              You&apos;re not in a studio yet
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              You followed an invitation, so this account joins a studio that already exists — you
              don&apos;t need to create one. If you asked to join, their admin still has to approve it.
              If you were invited by email, open the link in that email again.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link href="/app" className="btn-primary flex-1 py-2.5 text-center">
                Check again
              </Link>
              <Link href="/" className="btn-outline flex-1 py-2.5 text-center">
                Back to site
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Signed in but no workspace yet → they came on their own, so this is theirs.
  if (!ctx.membership) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Logo />
        </div>

        <main className="mx-auto max-w-lg px-5 py-10">
          <div className="card p-6 sm:p-8">
            <p className="label">Step 1 of 1</p>
            <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em]">Name your workspace</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              This is your team&apos;s home in WorkPulse, and you&apos;ll be the owner. You can rename it
              later. (If you meant to join someone else&apos;s studio, use the link they sent you — you
              don&apos;t need your own for that.)
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
              <button type="submit" className="btn-primary h-11 w-full">
                Create workspace
              </button>
            </form>

            {env.demoMode ? (
              <div className="mt-5">
                <Alert tone="info">
                  Demo mode: this creates a workspace in memory and it resets when the server restarts.
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
        <h1 className="mt-4 text-[30px] leading-tight font-semibold tracking-[-0.02em] sm:text-[38px]">
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
              className="card group flex flex-col p-5 transition hover:border-brand-line "
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl">{item.icon}</span>
                <span className="text-[11px] font-bold tracking-wide text-faint">0{i + 1}</span>
              </div>
              <h2 className="mt-3 text-[15.5px] font-semibold">{item.title}</h2>
              <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-muted">{item.body}</p>
              <span className="mt-3 text-[13px] font-bold text-brand group-hover:underline">{item.cta} →</span>
            </Link>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <LogoMark size={34} />
            <div>
              <div className="text-[13.5px] font-semibold">Ready when you are</div>
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
