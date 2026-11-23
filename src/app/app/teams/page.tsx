import { redirect } from "next/navigation";
import { TeamsManager } from "@/components/teams/TeamsManager";
import { getStore } from "@/lib/data";
import { orgMembers } from "@/lib/data/request-cache";
import { requireSession } from "@/lib/session";
import { isAdminRole } from "@/lib/types";

export const metadata = { title: "Teams" };
export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const session = await requireSession();
  if (!isAdminRole(session.membership.role)) redirect("/app/my-tasks");

  const orgId = session.organization.id;
  const [teams, members] = await Promise.all([
    getStore().listTeams(orgId),
    orgMembers(orgId),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Teams</h1>
        <p className="lede">
          Split the studio by craft. The dashboard can then show one team at a time.
        </p>
      </div>

      {/* The manager supplies its own inset, so the card only adds padding. */}
      <div className="card p-5">
        <TeamsManager teams={teams} members={members} />
      </div>
    </div>
  );
}
