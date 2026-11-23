import { AppShell } from "@/components/layout/AppShell";
import { orgMembers } from "@/lib/data/request-cache";
import { getOrgMemberships, requireSession } from "@/lib/session";

/*
 * NOTE: the function region deliberately is NOT set here.
 *
 * A route-level `export const preferredRegion` is ignored on the Hobby plan —
 * it is a single-region plan, and the region has to be set for the whole
 * project in vercel.json. See the "regions" key there. Setting it in both
 * places is confusing and the per-route one silently does nothing.
 */

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  // Shared with the page via React's request cache — see lib/data/request-cache.
  const [members, orgs] = await Promise.all([
    orgMembers(session.organization.id),
    getOrgMemberships(),
  ]);

  return (
    <AppShell
      session={session}
      seatsUsed={members.length}
      orgs={orgs.map((org) => ({ id: org.id, name: org.name, role: org.role }))}
    >
      {children}
    </AppShell>
  );
}
