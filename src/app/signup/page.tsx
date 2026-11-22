import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/AuthForms";
import { Badge, Logo } from "@/components/ui";
import { demoSignIn } from "@/lib/actions/auth";
import { env } from "@/lib/env";
import { getAuthContext } from "@/lib/session";

export const metadata = { title: "Create your workspace" };

type SignupSearchParams = Promise<{ next?: string; email?: string }>;

export default async function SignupPage({ searchParams }: { searchParams: SignupSearchParams }) {
  const sp = await searchParams;
  const ctx = await getAuthContext();

  // Invited visitors arrive with ?next=/invite/<token>; always send them back there.
  const next = sp.next?.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/app";
  if (ctx) redirect(next !== "/app" ? next : ctx.membership ? "/app" : "/onboarding");

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <Link href="/login" className="text-[13px] font-semibold text-muted hover:text-ink">
          I already have an account
        </Link>
      </div>

      <main className="mx-auto grid max-w-6xl items-start gap-10 px-5 py-8 lg:grid-cols-[1.05fr_.95fr] lg:py-14">
        <div className="hidden lg:block">
          <Badge tone="indigo">Free for up to 5 seats</Badge>
          <h1 className="mt-5 text-[40px] leading-[1.08] font-extrabold tracking-[-0.025em]">
            Set up your team in about two minutes.
          </h1>
          <ul className="mt-6 space-y-3 text-[14.5px] text-ink-2">
            {[
              "Create a workspace for your studio — isolated from every other customer.",
              "Invite freelancers with a link; they join as members automatically.",
              "Assign client tasks with estimates, deadlines and priorities.",
              "See everyone's free hours on one heatmap before you commit.",
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <span className="mt-0.5 text-ok">✓</span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="card mx-auto w-full max-w-md p-6 sm:p-8">
          <h2 className="text-[22px] font-extrabold tracking-[-0.01em]">Create your workspace</h2>
          <p className="mt-1.5 mb-6 text-[13.5px] leading-relaxed text-muted">
            You&apos;ll be the owner and can invite the rest of the team right after.
          </p>

          {env.demoMode ? (
            <>
              <div className="mb-4 rounded-xl border border-brand-line bg-brand-soft px-3.5 py-3 text-[12.5px] leading-relaxed font-semibold text-brand-dark">
                Demo mode: real sign-up needs a Supabase project. Jump straight into the product instead.
              </div>
              <form action={demoSignIn.bind(null, "11111111-1111-4111-8111-111111111111")}>
                <button type="submit" className="btn-primary w-full py-3">
                  Enter the demo as Owner
                </button>
              </form>
              <p className="mt-4 text-center text-[13px] text-muted">
                or{" "}
                <Link href="/login" className="font-bold text-brand">
                  pick a different demo user
                </Link>
              </p>
            </>
          ) : (
            <SignupForm next={next} email={sp.email ?? ""} />
          )}
        </div>
      </main>
    </div>
  );
}
