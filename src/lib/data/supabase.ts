import "server-only";
import { createSupabaseServerClient } from "../supabase/server";
import type {
  AvailabilityMap,
  Invite,
  Member,
  Membership,
  OrgRole,
  Organization,
  PlanTier,
  Profile,
  Task,
} from "../types";
import type { DataStore, TaskFilters } from "./types";

/* ----------------------------- row mappers ------------------------------ */
type Row = Record<string, any>;

const orgFromRow = (r: Row): Organization => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  plan: r.plan as PlanTier,
  seatLimit: r.seat_limit,
});

const profileFromRow = (r: Row): Profile => ({
  id: r.id,
  email: r.email,
  fullName: r.full_name,
  avatarUrl: r.avatar_url,
});

const membershipFromRow = (r: Row): Membership => ({
  id: r.id,
  orgId: r.org_id,
  userId: r.user_id,
  role: r.role as OrgRole,
  capacity: r.capacity,
});

const taskFromRow = (r: Row): Task => ({
  id: r.id,
  orgId: r.org_id,
  title: r.title,
  client: r.client ?? "",
  description: r.description,
  assigneeId: r.assignee_id,
  estHours: Number(r.est_hours),
  progress: r.progress,
  status: r.status,
  priority: r.priority,
  deadline: r.deadline,
  createdAt: r.created_at,
});

const inviteFromRow = (r: Row): Invite => ({
  id: r.id,
  email: r.email,
  role: r.role as OrgRole,
  token: r.token,
  expiresAt: r.expires_at,
  acceptedAt: r.accepted_at,
  createdAt: r.created_at,
});

function fail(error: { message: string } | null, context: string): void {
  if (!error) return;
  // Surface a friendly message; the DB raises human-readable exceptions.
  throw new Error(`${context}: ${error.message}`);
}

export class SupabaseStore implements DataStore {
  readonly kind = "supabase" as const;

  private async sb() {
    return createSupabaseServerClient();
  }

  async getOrg(orgId: string): Promise<Organization | null> {
    const sb = await this.sb();
    const { data, error } = await sb.from("organizations").select("*").eq("id", orgId).maybeSingle();
    fail(error, "load organization");
    return data ? orgFromRow(data) : null;
  }

  async updateOrg(orgId: string, patch: { name?: string; plan?: PlanTier; seatLimit?: number }): Promise<void> {
    const sb = await this.sb();
    const update: Row = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.plan !== undefined) update.plan = patch.plan;
    if (patch.seatLimit !== undefined) update.seat_limit = patch.seatLimit;
    const { error } = await sb.from("organizations").update(update).eq("id", orgId);
    fail(error, "update organization");
  }

  async listMembers(orgId: string): Promise<Member[]> {
    const sb = await this.sb();
    const { data, error } = await sb
      .from("memberships")
      .select("id, org_id, user_id, role, capacity, profiles!memberships_user_id_fkey(id, email, full_name, avatar_url)")
      .eq("org_id", orgId);
    fail(error, "load team");
    const rows = (data ?? []) as Row[];
    const rank: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2 };
    return rows
      .map((r) => ({ ...membershipFromRow(r), profile: profileFromRow(r.profiles ?? {}) }))
      .filter((m) => Boolean(m.profile.id))
      .sort(
        (a, b) =>
          rank[a.role] - rank[b.role] ||
          (a.profile.fullName ?? "").localeCompare(b.profile.fullName ?? ""),
      );
  }

  async getMembership(orgId: string, userId: string): Promise<Membership | null> {
    const sb = await this.sb();
    const { data, error } = await sb
      .from("memberships")
      .select("*")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    fail(error, "load membership");
    return data ? membershipFromRow(data) : null;
  }

  async updateMemberRole(orgId: string, membershipId: string, role: OrgRole): Promise<void> {
    const sb = await this.sb();
    const { error } = await sb.from("memberships").update({ role }).eq("id", membershipId).eq("org_id", orgId);
    fail(error, "update role");
    if (role !== "member") {
      // Admins and owners do not hold availability.
      await sb.from("availability").delete().eq("org_id", orgId).eq(
        "user_id",
        (await sb.from("memberships").select("user_id").eq("id", membershipId).single()).data?.user_id ?? "",
      );
    }
  }

  async updateMemberCapacity(orgId: string, membershipId: string, capacity: number): Promise<void> {
    const sb = await this.sb();
    const { error } = await sb
      .from("memberships")
      .update({ capacity })
      .eq("id", membershipId)
      .eq("org_id", orgId);
    fail(error, "update capacity");
  }

  async removeMember(orgId: string, membershipId: string): Promise<void> {
    const sb = await this.sb();
    const { error } = await sb.from("memberships").delete().eq("id", membershipId).eq("org_id", orgId);
    fail(error, "remove member");
  }

  async listTasks(orgId: string, filters: TaskFilters = {}): Promise<Task[]> {
    const sb = await this.sb();
    let q = sb.from("tasks").select("*").eq("org_id", orgId);
    if (filters.onlyForUser) q = q.eq("assignee_id", filters.onlyForUser);
    if (filters.assigneeId) q = q.eq("assignee_id", filters.assigneeId);
    if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
    if (filters.search) q = q.or(`title.ilike.%${filters.search}%,client.ilike.%${filters.search}%`);
    const { data, error } = await q;
    fail(error, "load tasks");
    return ((data ?? []) as Row[]).map(taskFromRow);
  }

  async createTask(
    orgId: string,
    input: Omit<Task, "id" | "orgId" | "createdAt">,
    actorId: string,
  ): Promise<Task> {
    const sb = await this.sb();
    const { data, error } = await sb
      .from("tasks")
      .insert({
        org_id: orgId,
        title: input.title,
        client: input.client ?? "",
        description: input.description ?? null,
        assignee_id: input.assigneeId,
        est_hours: input.estHours,
        progress: input.progress ?? 0,
        status: input.status ?? "pending",
        priority: input.priority ?? "medium",
        deadline: input.deadline ?? null,
        created_by: actorId,
      })
      .select("*")
      .single();
    fail(error, "create task");
    return taskFromRow(data as Row);
  }

  async updateTask(orgId: string, taskId: string, patch: Partial<Task>): Promise<void> {
    const sb = await this.sb();
    const update: Row = {};
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.client !== undefined) update.client = patch.client;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.assigneeId !== undefined) update.assignee_id = patch.assigneeId;
    if (patch.estHours !== undefined) update.est_hours = patch.estHours;
    if (patch.progress !== undefined) update.progress = patch.progress;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.priority !== undefined) update.priority = patch.priority;
    if (patch.deadline !== undefined) update.deadline = patch.deadline;
    const { error } = await sb.from("tasks").update(update).eq("id", taskId).eq("org_id", orgId);
    fail(error, "update task");
  }

  async deleteTask(orgId: string, taskId: string): Promise<void> {
    const sb = await this.sb();
    const { error } = await sb.from("tasks").delete().eq("id", taskId).eq("org_id", orgId);
    fail(error, "delete task");
  }

  async getAvailability(
    orgId: string,
    userIds: string[],
    dates: string[],
  ): Promise<Record<string, AvailabilityMap>> {
    const out: Record<string, AvailabilityMap> = Object.fromEntries(userIds.map((id) => [id, {}]));
    if (!userIds.length || !dates.length) return out;
    const sb = await this.sb();
    const { data, error } = await sb
      .from("availability")
      .select("user_id, slot_date, hours")
      .eq("org_id", orgId)
      .in("user_id", userIds)
      .in("slot_date", dates);
    fail(error, "load availability");
    for (const row of (data ?? []) as Row[]) {
      const map = out[row.user_id] ?? (out[row.user_id] = {});
      map[row.slot_date] = (row.hours ?? []).map(Number);
    }
    return out;
  }

  async saveAvailability(orgId: string, userId: string, date: string, hours: number[]): Promise<void> {
    const sb = await this.sb();
    const clean = [...new Set(hours)].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b);
    if (!clean.length) {
      const { error } = await sb
        .from("availability")
        .delete()
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("slot_date", date);
      fail(error, "clear availability");
      return;
    }
    const { error } = await sb
      .from("availability")
      .upsert(
        { org_id: orgId, user_id: userId, slot_date: date, hours: clean },
        { onConflict: "org_id,user_id,slot_date" },
      );
    fail(error, "save availability");
  }

  async listInvites(orgId: string): Promise<Invite[]> {
    const sb = await this.sb();
    const { data, error } = await sb
      .from("invites")
      .select("*")
      .eq("org_id", orgId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    fail(error, "load invites");
    return ((data ?? []) as Row[]).map(inviteFromRow);
  }

  async createInvite(orgId: string, email: string, role: OrgRole): Promise<Invite> {
    const sb = await this.sb();
    const { data: token, error } = await sb.rpc("create_invite", {
      target_org: orgId,
      invite_email: email || null,
      invite_role: role,
    });
    fail(error, "create invite");
    const { data, error: readError } = await sb
      .from("invites")
      .select("*")
      .eq("token", token as string)
      .single();
    fail(readError, "read invite");
    return inviteFromRow(data as Row);
  }

  async revokeInvite(orgId: string, inviteId: string): Promise<void> {
    const sb = await this.sb();
    const { error } = await sb.from("invites").delete().eq("id", inviteId).eq("org_id", orgId);
    fail(error, "revoke invite");
  }
}
