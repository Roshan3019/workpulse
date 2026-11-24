import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/AuthForms";
import { Alert } from "@/components/ui/Modal";
import { Avatar, Badge, Logo } from "@/components/ui";
import { demoSignIn } from "@/lib/actions/auth";
import { memoryStore } from "@/lib/data";
import { env } from "@/lib/env";
import { getAuthContext } from "@/lib/session";
import { ROLE_LABEL, ROLE_TONE } from "@/lib/types";

export const metadata = { title: "Sign in" };

type LoginSearchParams = Promise<{ next?: string; error?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: LoginSearchParams }) {
  const sp = await searchParams;
  const ctx = await getAuthContext();
  /* Signed in but studio-less: they came here directly, so this is the create-your-own path. */
  if (ctx) redirect(ctx.membership ? "/app" : "/onboarding?via=direct");

  // Only same-site relative paths, so ?next= can't be used as an open redirect.
  const next = sp.next?.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/app";

  const demoUsers = env.demoMode ? await memoryStore.listDemoUsers() : [];

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <Link href="/" className="text-[13px] font-semibold text-muted hover:text-ink">
          ← Back to site
        </Link>
      </div>

      <main className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-8 lg:grid-cols-[1.05fr_.95fr] lg:py-16">
        <div className="hidden lg:block">
          <Badge tone="indigo">Team availability, decoded</Badge>
          <h1 className="mt-5 text-[46px] leading-[1.06] font-semibold tracking-[-0.025em]">
            Know exactly <span className="text-brand">who&apos;s free</span>, who&apos;s slammed, and who&apos;s
            shipping.
          </h1>
          <p className="mt-5 max-w-lg text-[15.5px] leading-relaxed text-muted">
            WorkPulse gives you a live weekly view of every freelancer&apos;s free hours, the client work on their
            plate, and how close each task is to done, all in one place.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            {["Team workload", "Weekly hours", "Live status", "Client tasks"].map((chip) => (
              <span
                key={chip}
                className="rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-ink-2"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>

        <div className="card mx-auto w-full max-w-md p-6 sm:p-8">
          <h2 className="text-[19px] font-semibold tracking-[-0.015em]">Sign in to continue</h2>
          <p className="mt-1.5 mb-6 text-[13.5px] leading-relaxed text-muted">
            Use your work account. Team admins land on the workload dashboard, freelancers get their own view.
          </p>

          {sp.error ? (
            <div className="mb-4">
              <Alert tone="error">{sp.error}</Alert>
            </div>
          ) : null}

          {env.demoMode ? (
            <>
              <div className="mb-4 rounded-xl border border-brand-line bg-brand-soft px-3.5 py-3 text-[12.5px] leading-relaxed font-semibold text-brand-dark">
                Demo mode: pick a user to explore the product. Password and Google sign-in activate once you add your
                Supabase keys.
              </div>
              <div className="space-y-1.5">
                {demoUsers.map((user) => (
                  <form key={user.id} action={demoSignIn.bind(null, user.id)}>
                    <button
                      type="submit"
                      className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition hover:border-line hover:bg-[#fbfaf8]"
                    >
                      <Avatar id={user.id} name={user.fullName} email={user.email} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold">
                          {user.fullName ?? user.email}
                        </span>
                        <span className="block truncate text-[12px] text-muted">{user.email}</span>
                      </span>
                      <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABEL[user.role]}</Badge>
                    </button>
                  </form>
                ))}
              </div>
              <p className="mt-4 text-[12px] leading-relaxed text-faint">
                Sign in as <b>Roshan Patel (Owner)</b> to see the admin console, or as any Member to see the freelancer
                view.
              </p>
            </>
          ) : (
            <LoginForm next={next} />
          )}
        </div>
      </main>
    </div>
  );
}
