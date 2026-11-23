import Link from "next/link";
import { Avatar, Logo } from "@/components/ui";
import { RequestToJoin } from "@/components/team/RequestToJoin";
import { getStore } from "@/lib/data";
import { getAuthContext } from "@/lib/session";
import { isAdminRole } from "@/lib/types";

export const metadata = { title: "Join this studio" };
export const dynamic = "force-dynamic";

/**
 * The common join link.
 *
 * Deliberately not the same page as an email invite: an email invite means
 * "you were chosen, come in". This link means "ask, and someone will decide".
 * The copy has to make that difference obvious before the person clicks.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [link, session] = await Promise.all([getStore().findJoinLink(token), getAuthContext()]);

  if (!link) {
    return (
      <Shell>
        <h1 className="text-[23px] font-semibold tracking-[-0.02em] text-ink">
          This link is no longer valid
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          The studio replaced it, or turned joining off. Ask an admin for a fresh link.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link href="/login" className="btn-primary flex-1 py-2.5 text-center">
            Sign in
          </Link>
          <Link href="/" className="btn-outline flex-1 py-2.5 text-center">
            Back to site
          </Link>
        </div>
      </Shell>
    );
  }

  if (!link.enabled) {
    return (
      <Shell>
        <h1 className="text-[23px] font-semibold tracking-[-0.02em] text-ink">Joining is paused</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {link.orgName} isn&apos;t accepting new people through this link right now.
        </p>
        <div className="mt-6">
          <Link href="/" className="btn-outline block py-2.5 text-center">
            Back to site
          </Link>
        </div>
      </Shell>
    );
  }

  // A signed-in visitor may have no studio yet (fresh signup) — that's fine
  // here, they're asking to join this one.
  const alreadyIn = session?.organization?.id === link.orgId;
  const pending = session ? await getStore().getMyJoinRequest(link.orgId, session.user.id) : null;

  return (
    <Shell>
      <h1 className="text-[23px] font-semibold tracking-[-0.02em] text-ink">
        Request to join {link.orgName}
      </h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
        This link is shared, so it doesn&apos;t add you straight away. Send a request and an admin
        will approve it, usually the same day.
      </p>

      {alreadyIn ? (
        <div className="mt-6 rounded-lg border border-line bg-[#fbfaf8] px-3.5 py-3 text-[13px] text-ink-2">
          You&apos;re already in {link.orgName}.{" "}
          <Link href="/app" className="font-medium text-ink underline">
            Open the dashboard
          </Link>
          .
        </div>
      ) : pending ? (
        <div className="mt-6 rounded-lg border border-line bg-[#fbfaf8] px-3.5 py-3">
          <p className="text-[13px] font-medium text-ink">Your request is waiting</p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Sent {new Date(pending.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}. An
            admin still needs to approve it. We&apos;ll let you in the moment they do.
          </p>
        </div>
      ) : (
        <>
          {session ? (
            <div className="mt-6 flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5">
              <Avatar
                id={session.user.id}
                name={session.user.fullName}
                email={session.user.email}
                src={session.user.avatarUrl}
                size={28}
              />
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium text-ink">
                  {session.user.fullName ?? session.user.email}
                </p>
                <p className="text-[11.5px] text-faint">You&apos;ll join as a member</p>
              </div>
            </div>
          ) : null}

          <div className="mt-4">
            {session ? (
              <RequestToJoin token={token} />
            ) : (
              <Link
                href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}
                className="btn-primary block w-full py-2.5 text-center"
              >
                Sign in to request
              </Link>
            )}
          </div>
          <p className="mt-3 text-center text-[11.5px] text-faint">
            No account yet? Signing in with Google creates one. You&apos;ll come straight back here.
          </p>
        </>
      )}

      {session?.membership && isAdminRole(session.membership.role) ? (
        <p className="mt-6 border-t border-line pt-4 text-[12px] text-muted">
          You&apos;re an admin here. Share this link from{" "}
          <Link href="/app/settings" className="underline">
            Settings → Invites
          </Link>
          .
        </p>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#faf9f6] px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-7 flex justify-center">
          <Logo href="/" />
        </div>
        <div className="rounded-xl border border-line bg-white p-6 sm:p-7">{children}</div>
      </div>
    </main>
  );
}
