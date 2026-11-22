import { AppShell } from "@/components/layout/AppShell";
import { orgMembers } from "@/lib/data/request-cache";
import { requireSession } from "@/lib/session";

/*
 * Render the app in the same region as the database.
 *
 * Supabase is in Mumbai (ap-south-1). Vercel's default is Washington D.C., so
 * every query was crossing the planet twice — ~200ms of pure network per
 * round trip, multiplied by a dozen queries per page. `bom1` is Vercel's
 * Mumbai region and is also closest to the app's users.
 *
 * Set on the layout so every /app page inherits it. If you move the Supabase
 * project, update this to the matching region.
 */
export const preferredRegion = "bom1";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  // Shared with the page via React's request cache — see lib/data/request-cache.
  const members = await orgMembers(session.organization.id);

  return (
    <AppShell session={session} seatsUsed={members.length}>
      {children}
    </AppShell>
  );
}
