import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar, Badge, Logo } from "@/components/ui";
import { Alert } from "@/components/ui/Modal";
import { acceptInviteAction } from "@/lib/actions/org";
import { getStore } from "@/lib/data";
import { getAuthContext } from "@/lib/session";
import { env } from "@/lib/env";

export const metadata = { title: "Join your team" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Resolve the invite first: it tells us which team the visitor is joining,
  // and it must work for someone who is not signed in yet (that's the whole
  // point of an invite link — sign up first, then land back here).
  const invite = await getStore().getInviteByToken(token).catch(() => null);

  if (!invite) {
    return (
      <InviteShell>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">This invite link is no longer valid</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          It may have expired after 14 days, already been used, or been revoked by an admin. Ask whoever invited you
          to send a fresh link.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link href="/login" className="btn-primary flex-1 py-3 text-center">
            Go to sign in
          </Link>
          <Link href="/" className="btn-outline flex-1 py-3 text-center">
            Back to site
          </Link>
        </div>
      </InviteShell>
    );
  }

  const ctx = await getAuthContext();

  // Not signed in → sign up / sign in first, then come straight back here.
  if (!ctx) {
    const next = encodeURIComponent(`/invite/${token}`);
    return (
      <InviteShell>
        <div className="mb-4 flex justify-center">
          <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-brand-soft text-xl">🏢</span>
        </div>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">
          {invite.orgName ? `Join ${invite.orgName}` : "You're invited"}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          You&apos;ve been invited to collaborate as a <b>{invite.role}</b>. Sign in — or create a free account in
          seconds — and you&apos;ll join the team automatically.
          {invite.email ? (
            <>
              {" "}
              Use <b>{invite.email}</b> so the invite is matched to you.
            </>
          ) : null}
        </p>

        <div className="mt-6 space-y-2.5">
          <Link
            href={`/signup?next=${next}${invite.email ? `&email=${encodeURIComponent(invite.email)}` : ""}`}
            className="btn-primary block w-full py-3 text-center"
          >
            Create an account
          </Link>
          <Link href={`/login?next=${next}`} className="btn-outline block w-full py-3 text-center">
            I already have an account
          </Link>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-faint">
          Google sign-in works too — you&apos;ll come back to this page to accept.
        </p>
      </InviteShell>
    );
  }

  // Signed in but this invite is addressed to a different email address.
  const emailMismatch =
    Boolean(invite.email) &&
    invite.email!.toLowerCase() !== ctx.user.email.toLowerCase();

  if (emailMismatch) {
    return (
      <InviteShell>
        <div className="mb-4 flex justify-center">
          <Avatar id={ctx.user.id} name={ctx.user.fullName} email={ctx.user.email} size={52} />
        </div>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">This invite is for someone else</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          The invite for {invite.orgName ? <b>{invite.orgName}</b> : "this team"} was sent to{" "}
          <b>{invite.email}</b>, but you&apos;re signed in as <b>{ctx.user.email}</b>.
        </p>
        <div className="mt-6">
          <Alert tone="info">
            Sign out and sign back in with {invite.email}, then reopen this link. Ask an admin for a new link if you
            need it sent to a different address.
          </Alert>
        </div>
        <Link href="/login" className="btn-primary mt-4 block w-full py-3 text-center">
          Switch account
        </Link>
      </InviteShell>
    );
  }

  const store = getStore();
  const members = invite.orgId ? await store.listMembers(invite.orgId).catch(() => []) : [];

  return (
    <InviteShell>
      <div className="mb-4 flex justify-center gap-2">
        <Avatar id={ctx.user.id} name={ctx.user.fullName} email={ctx.user.email} size={52} />
        <span className="grid place-items-center text-2xl text-faint">+</span>
        <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-brand-soft text-xl">🏢</span>
      </div>

      <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">
        {invite.orgName ? `Join ${invite.orgName}` : "Join your team"}
      </h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
        You&apos;ve been invited as a <b>{invite.role}</b> in WorkPulse. Accept and you&apos;ll only see your own tasks
        and your availability calendar.
      </p>

      {members.length ? (
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
    </InviteShell>
  );
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
      </div>
      <main className="mx-auto max-w-lg px-5 py-10">
        <div className="card p-6 text-center sm:p-8">{children}</div>
      </main>
    </div>
  );
}
