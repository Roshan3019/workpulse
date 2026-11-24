import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Logo, LogoMark } from "@/components/ui";
import { getAuthContext } from "@/lib/session";
import { env } from "@/lib/env";
import { PLANS } from "@/lib/types";

export default async function LandingPage() {
  const ctx = await getAuthContext();
  if (ctx) redirect(ctx.membership ? "/app" : "/onboarding?via=direct");

  const features = [
    {
      title: "Workload per freelancer",
      body: "Remaining hours vs weekly capacity, colour-coded so you can spot who's free before you assign the next job.",
      icon: "⚖️",
    },
    {
      title: "Overall time slots",
      body: "One heatmap of every teammate's free hours for the next 7 days, plus plain-English ranges: MON 9a–5p, TUE 10a–2p.",
      icon: "🗓️",
    },
    {
      title: "Client tasks & deadlines",
      body: "Task, client, estimate, priority, deadline and progress: the five things you actually need to run a studio.",
      icon: "🎯",
    },
    {
      title: "Drag-to-paint availability",
      body: "Freelancers pick a date and drag across the grid to mark free hours. Works on desktop, tablet and phone.",
      icon: "🖌️",
    },
    {
      title: "Roles that behave",
      body: "Admins manage the team and can't change their own role. Owners transfer ownership deliberately, never by accident.",
      icon: "🔐",
    },
    {
      title: "Built to resell",
      body: "Multi-tenant from day one: every company gets an isolated workspace, seat limits and its own team.",
      icon: "🏢",
    },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Logo />
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost btn-sm">
              Sign in
            </Link>
            <Link href="/signup" className="btn-primary btn-sm">
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 lg:grid-cols-[1.05fr_.95fr] lg:py-20">
          <div>
            <Badge tone="indigo">Team availability, decoded</Badge>
            <h1 className="mt-5 text-[38px] leading-[1.05] font-semibold tracking-[-0.025em] sm:text-[54px]">
              Know exactly <span className="text-brand">who&apos;s free</span>, who&apos;s slammed, and who&apos;s
              shipping.
            </h1>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-muted">
              WorkPulse gives you a live weekly view of every freelancer&apos;s free hours, the client work on their
              plate, and how close each task is to done, all in one place.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/signup" className="btn-primary">
                Create your workspace
              </Link>
              <Link href="/login" className="btn-outline">
                {env.demoMode ? "Try the live demo" : "Sign in"}
              </Link>
            </div>
            {env.demoMode ? (
              <p className="mt-3 text-[12.5px] font-semibold text-brand-dark">
                Demo mode is on. No account needed: click through the whole product with sample data.
              </p>
            ) : null}
          </div>

          {/* mini product illustration (pure CSS, no images) */}
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11.5px] font-medium text-muted">Workload per freelancer</div>
                <p className="mt-0.5 text-[11.5px] text-faint">Remaining hours against weekly capacity</p>
              </div>
              <LogoMark size={30} />
            </div>
            <div className="mt-4 space-y-3.5">
              {[
                { name: "Aarav Shah", hours: 21, cap: 32, tone: "bg-warn", pct: 66, label: "Busy", badge: "pill-amber" },
                { name: "Priya Mehta", hours: 13, cap: 24, tone: "bg-ok", pct: 54, label: "Balanced", badge: "pill-indigo" },
                { name: "Kabir Rao", hours: 14, cap: 36, tone: "bg-ok", pct: 39, label: "Available", badge: "pill-green" },
              ].map((row) => (
                <div key={row.name}>
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-medium">{row.name}</span>
                    <span className="text-muted">
                      {row.hours}h / {row.cap}h
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="track flex-1">
                      <div className={`h-full rounded-full ${row.tone}`} style={{ width: `${row.pct}%` }} />
                    </div>
                    <span className={`pill ${row.badge}`}>{row.label}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-[8px] border border-line p-3">
              <div className="text-[11.5px] font-medium text-muted">Team slots, next 7 days</div>
              <div className="mt-2 flex gap-1">
                {[5, 7, 6, 8, 4, 2, 0].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-[4px] py-1.5 text-center text-[11px] font-medium tabular-nums"
                    style={{
                      background:
                        h === 0 ? "#f2efea" : h <= 3 ? "#dfede4" : h <= 6 ? "#a9cdb8" : "#3f8f63",
                      color: h === 0 ? "#a09a90" : h <= 4 ? "#2f6b4a" : "#fff",
                    }}
                  >
                    {h}h
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* features */}
        <section className="border-y border-line bg-white/70">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <h2 className="text-[26px] font-semibold tracking-[-0.02em] sm:text-[32px]">
              Everything a freelance team needs. Nothing it doesn&apos;t.
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="card p-5">
                  <div className="text-2xl">{f.icon}</div>
                  <h3 className="mt-2 text-[15.5px] font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* pricing */}
        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="text-center">
            <h2 className="text-[26px] font-semibold tracking-[-0.02em] sm:text-[32px]">Simple, seat-based pricing</h2>
            <p className="mx-auto mt-2 max-w-xl text-[14.5px] text-muted">
              Start free. Upgrade when your crew grows. Every plan includes unlimited clients and tasks.
            </p>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {Object.entries(PLANS).map(([key, plan]) => (
              <div
                key={key}
                className={`card flex flex-col p-6 ${key === "pro" ? "ring-2 ring-brand" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{plan.label}</h3>
                  {key === "pro" ? <Badge tone="indigo">Popular</Badge> : null}
                </div>
                <p className="mt-1 text-[13px] text-muted">{plan.blurb}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-[32px] font-semibold tracking-[-0.03em] tabular-nums">
                    {plan.priceMonthly === 0 ? "Free" : `$${plan.priceMonthly}`}
                  </span>
                  {plan.priceMonthly ? <span className="text-sm font-semibold text-muted">/mo</span> : null}
                </div>
                <div className="mt-1 text-[12.5px] font-bold text-brand">Up to {plan.seats} seats</div>
                <ul className="mt-4 flex-1 space-y-2 text-[13.5px] text-ink-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-ok">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`mt-5 ${key === "pro" ? "btn-primary" : "btn-outline"} w-full`}
                >
                  {plan.priceMonthly === 0 ? "Start free" : `Choose ${plan.label}`}
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-[12.5px] text-faint">
            Billing isn&apos;t wired yet in this build. Plans and seat limits are enforced; payments come next.
          </p>
        </section>
      </main>

      <footer className="border-t border-line bg-white/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-[12.5px] text-muted">
          <span>© {new Date().getFullYear()} WorkPulse. All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/login">Sign in</Link>
            <Link href="/signup">Start free</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
