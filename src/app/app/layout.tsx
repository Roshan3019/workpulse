import { AppShell } from "@/components/layout/AppShell";
import { getStore } from "@/lib/data";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const members = await getStore().listMembers(session.organization.id);

  return (
    <AppShell session={session} seatsUsed={members.length}>
      {children}
    </AppShell>
  );
}
