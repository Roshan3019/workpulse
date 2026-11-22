import { redirect } from "next/navigation";
import { Avatar, Badge, Logo } from "@/components/ui";
import { Alert } from "@/components/ui/Modal";
import { acceptInviteAction } from "@/lib/actions/org";
import { getStore } from "@/lib/data";
import { DEMO_ORG_ID } from "@/lib/data/types";
import { getAuthContext } from "@/lib/session";
import { env } from "@/lib/env";

export const metadata = { title: "Join your team" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await getAuthContext();

  // Look up the invite so we can show "You're joining <org>" before acceptance.
  const store = getStore();
  const org = await store.getOrg(env.demoMode ? DEMO_ORG_ID : ctx?.organization?.id ?? "");
  const members = org ? await store.listMembers(org.id) : [];

  if (!ctx) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
      </div>

      <main className="mx-auto max-w-lg px-5 py-10">
        <div className="card p-6 text-center sm:p-8">
          <div className="mb-4 flex justify-center gap-2">
            <Avatar id={ctx.user.id} name={ctx.user.fullName} email={ctx.user.email} size={52} />
            <span className="grid place-items-center text-2xl text-faint">+</span>
            <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-brand-soft text-xl">🏢</span>
          </div>

          <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">
            {org ? `Join ${org.name}` : "Join your team"}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            You&apos;ve been invited to collaborate in WorkPulse. Accept and you&apos;ll join as a member — you&apos;ll
            only see your own tasks and your availability calendar.
          </p>

          {org && members.length ? (
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {members.slice(0, 6).map((m) => (
                <Badge key={m.id} tone="grey">
                  {m.profile.fullName?.split(" ")[0] ?? m.profile.email}
                </Badge>
              ))}
              {members.length > 6 ? <Badge tone="grey">+{members.length - 6} more</Badge> : null}
            </div>
          ) : null}

          <form
            action={async () => {
              "use server";
              await acceptInviteAction(token);
            }}
            className="mt-6"
          >
            <button type="submit" className="btn-primary w-full py-3">
              Accept invite
            </button>
          </form>

          <div className="mt-4">
            <Alert tone="info">
              Signed in as <b>{ctx.user.email}</b>
              {env.demoMode ? " · demo mode: invites are simulated." : ""}
            </Alert>
          </div>
        </div>
      </main>
    </div>
  );
}
