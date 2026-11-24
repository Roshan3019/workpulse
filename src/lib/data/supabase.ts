import "server-only";
import { createSupabaseServerClient } from "../supabase/server";
import { hoursFromStates, normaliseStates, normaliseWeeklyDefault } from "../availability";
import { busyStatesForPlans, normaliseBlocks } from "../plans";
import { assigneesOf } from "../types";
import type {
  AvailabilityMap,
  AvailabilityStates,
  Invite,
  JoinLink,
  JoinRequest,
  Member,
  MyJoinRequest,
  Membership,
  OrgRole,
  Organization,
  PlanTier,
  Profile,
  SlotState,
  Task,
  TaskPlan,
  Team,
  WeeklyDefault,
} from "../types";
import type {
  DataStore,
  InviteLookup,
  PlanBlockInput,
  TaskFilters,
  TaskPlanFilters,
} from "./types";

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
  /*
   * Everyone on the task comes from `task_assignees` (0009). Older rows have
   * no join rows at all, so `assigneeId` remains the fallback and the two never
   * disagree: the action always writes both.
   */
  assigneeIds: mergeAssignees(r.assignee_id, r.task_assignees),
  estHours: Number(r.est_hours),
  progress: r.progress,
  status: r.status,
  priority: r.priority,
  deadline: r.deadline,
  startDate: r.start_date ?? null,
  dueTime: r.due_time ? String(r.due_time).slice(0, 5) : null,
  teamId: r.team_id ?? null,
  createdAt: r.created_at,
});

/** `42P01` = undefined_table; `PGRST205` = table not in the schema cache. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /relation .*task_assignees.* does not exist/i.test(error.message ?? "");
}

/**
 * Is `error` about the `task_assignees` embed specifically? (`PGRST200`,
 * `PGRST201`, `PGRST108` … all mean "that relationship is not there".)
 *
 * Before 0010 the table does not exist, so the task list has to keep working —
 * without multi-assign, but without a 500 on every page.
 */
function isAssigneeEmbedError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (!/^PGRST/.test(error.code ?? "")) return false;
  return /task_assignees/i.test(error.message ?? "");
}

/**
 * One canonical assignee list. The lead column is always first, and the join
 * rows are merged in after it without duplicates.
 */
function mergeAssignees(lead: string | null, rows: unknown): string[] {
  const joined = Array.isArray(rows)
    ? (rows as { user_id?: string; position?: number }[])
        .slice()
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((row) => row.user_id)
        .filter((id): id is string => Boolean(id))
    : [];
  const out: string[] = [];
  for (const id of [lead, ...joined]) if (id && !out.includes(id)) out.push(id);
  return out;
}

const teamFromRow = (r: Row): Team => ({
  id: r.id,
  orgId: r.org_id,
  name: r.name,
  slug: r.slug,
  memberIds: ((r.team_members ?? []) as { user_id: string }[]).map((m) => m.user_id),
  createdAt: r.created_at,
});

/** "Web Team" -> "web-team". Strips accents so slugs stay URL-safe. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const inviteFromRow = (r: Row): Invite => ({
  id: r.id,
  email: r.email,
  role: r.role as OrgRole,
  token: r.token,
  expiresAt: r.expires_at,
  acceptedAt: r.accepted_at,
  createdAt: r.created_at,
});

/**
 * Postgres / PostgREST codes that mean "the schema is older than the app".
 *
 * 42P01 no such table, 42703 no such column, PGRST205 table not in the schema
 * cache, PGRST204 column not in the schema cache. Every read that can meet one
 * of these degrades instead of taking the page down — the previous behaviour was
 * a black error screen wherever a deploy landed before its migration.
 */
function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "")) return true;
  const message = error.message ?? "";
  return /does not exist|schema cache/i.test(message) && !/permission|policy/i.test(message);
}

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

  async listMembershipsForUser(userId: string): Promise<Membership[]> {
    const sb = await this.sb();
    const { data, error } = await sb
      .from("memberships")
      .select("id, org_id, user_id, role, capacity, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    fail(error, "list memberships");
    return ((data ?? []) as Row[]).map((row) => ({
      ...membershipFromRow(row),
      createdAt: row.created_at,
    }));
  }

  async listOrgsForUser(userId: string): Promise<Organization[]> {
    const sb = await this.sb();
    const { data, error } = await sb
      .from("memberships")
      .select("org_id, role, organizations(id, name, slug, plan, seat_limit)")
      .eq("user_id", userId);
    fail(error, "list studios");
    return ((data ?? []) as Row[])
      .map((row) => row.organizations as Row | null)
      .filter((org): org is Row => Boolean(org))
      .map((org) => ({
        id: org.id as string,
        name: org.name as string,
        slug: org.slug as string,
        plan: org.plan as PlanTier,
        seatLimit: org.seat_limit as number,
      }));
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

    /*
     * Who is "assigned to me"? Either the lead (`tasks.assignee_id`) or anyone
     * in `task_assignees`.
     *
     * PostgREST cannot express that in one filter: putting an embedded table's
     * column inside an `or()` on the parent —
     * `or=(assignee_id.eq.X,task_assignees.user_id.eq.X)` — is a logic-tree
     * parse error, which is exactly what broke /app/my-tasks. The two
     * conditions are two indexed queries, merged by id.
     */
    const person = filters.onlyForUser ?? filters.assigneeId ?? null;
    let ids: string[] | null = null;
    if (person) {
      const [led, joined] = await Promise.all([
        sb.from("tasks").select("id").eq("org_id", orgId).eq("assignee_id", person),
        sb.from("task_assignees").select("task_id").eq("user_id", person),
      ]);
      fail(led.error, "load tasks");
      /*
       * A project that has not run 0010 yet has no `task_assignees` at all.
       * That is not a failure: fall back to the lead-only list below.
       */
      const joinedRows = isMissingTable(joined.error) ? [] : ((joined.data ?? []) as Row[]);
      if (!isMissingTable(joined.error)) fail(joined.error, "load assignments");
      ids = [
        ...new Set([
          ...((led.data ?? []) as Row[]).map((r) => r.id as string),
          ...joinedRows.map((r) => r.task_id as string),
        ]),
      ];
      if (!ids.length) return [];
    }

    const run = async (withAssignees: boolean) => {
      let q = sb
        .from("tasks")
        .select(withAssignees ? "*, task_assignees(user_id, position)" : "*")
        .eq("org_id", orgId);
      if (ids) q = q.in("id", ids);
      if (filters.teamId) q = q.eq("team_id", filters.teamId);
      if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.search) q = q.or(`title.ilike.%${filters.search}%,client.ilike.%${filters.search}%`);
      return q;
    };

    const first = await run(true);
    if (isAssigneeEmbedError(first.error)) {
      /*
       * 0010 not applied here: read the tasks without the embed. Every task
       * still shows its lead, so the app works — it just cannot show a second
       * person until the migration runs. Better than a 500 on every page.
       */
      const fallback = await run(false);
      fail(fallback.error, "load tasks");
      return ((fallback.data ?? []) as Row[]).map(taskFromRow);
    }
    fail(first.error, "load tasks");
    return ((first.data ?? []) as Row[]).map(taskFromRow);
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
        start_date: input.startDate ?? null,
        due_time: input.dueTime ?? null,
        team_id: input.teamId ?? null,
        created_by: actorId,
      })
      .select("*")
      .single();
    /*
     * A deploy can land before its migration. `start_date` / `due_time` arrived
     * in 0003 and `team_id` in 0005, so on an older project this insert fails
     * with 42703 and used to surface as "create task: column ... does not
     * exist" on the dashboard — or, worse, a 500. Retrying without the newer
     * columns keeps the admin's actual job (create the task) working, and the
     * task shows the moment the migration is run.
     */
    if (isMissingSchema(error)) {
      const { data: retried, error: retryError } = await sb
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
      if (retryError) {
        fail(retryError, "create task");
        throw new Error(`create task: ${retryError.message}`);
      }
      await this.setTaskAssignees(orgId, (retried as Row).id as string, assigneesOf(input)).catch(() => {});
      return { ...taskFromRow(retried as Row), assigneeIds: assigneesOf(input) };
    }
    fail(error, "create task");
    await this.setTaskAssignees(orgId, (data as Row).id as string, assigneesOf(input));
    const created = await sb
      .from("tasks")
      .select("*, task_assignees(user_id, position)")
      .eq("id", (data as Row).id as string)
      .single();
    return taskFromRow((created.data ?? data) as Row);
  }

  /**
   * Replace who is on a task. Ordered, so the lead (position 0) stays the
   * person shown first on every card.
   */
  private async setTaskAssignees(orgId: string, taskId: string, userIds: string[]): Promise<void> {
    const sb = await this.sb();
    const clean = [...new Set(userIds.filter(Boolean))];
    if (!clean.length) return;
    const { error: clearError } = await sb.from("task_assignees").delete().eq("task_id", taskId);
    if (isMissingTable(clearError)) return; // 0010 not applied: lead-only rows are fine
    fail(clearError, "clear assignments");
    const { error } = await sb.from("task_assignees").insert(
      clean.map((userId, position) => ({ org_id: orgId, task_id: taskId, user_id: userId, position })),
    );
    if (isMissingTable(error)) return;
    fail(error, "save assignments");
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
    if (patch.startDate !== undefined) update.start_date = patch.startDate;
    if (patch.dueTime !== undefined) update.due_time = patch.dueTime;
    // Was missing: a task's team could never change after creation.
    if (patch.teamId !== undefined) update.team_id = patch.teamId;
    const { error } = await sb.from("tasks").update(update).eq("id", taskId).eq("org_id", orgId);
    fail(error, "update task");
    if (patch.assigneeIds !== undefined) {
      await this.setTaskAssignees(orgId, taskId, patch.assigneeIds);
    }
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

  /* ------------------------------- teams ------------------------------- */

  async listTeams(orgId: string): Promise<Team[]> {
    const sb = await this.sb();
    // One round trip: teams plus their rosters via the embedded select.
    const { data, error } = await sb
      .from("teams")
      .select("id, org_id, name, slug, created_at, team_members(user_id)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });
    fail(error, "load teams");
    return ((data ?? []) as Row[]).map(teamFromRow);
  }

  async createTeam(orgId: string, name: string, memberIds: string[]): Promise<Team> {
    const sb = await this.sb();
    const clean = name.trim();
    if (!clean) throw new Error("Give the team a name");

    // Slugs are unique per studio; retry on the unlikely collision rather than
    // failing the create with a database error the user cannot act on.
    const base = slugify(clean) || "team";
    let slug = base;
    for (let attempt = 1; attempt <= 20; attempt++) {
      const { data, error } = await sb
        .from("teams")
        .insert({ org_id: orgId, name: clean, slug })
        .select("id, org_id, name, slug, created_at")
        .single();
      if (!error) {
        const team = teamFromRow({ ...data, team_members: [] });
        if (memberIds.length) await this.setTeamMembers(orgId, team.id, memberIds);
        return { ...team, memberIds };
      }
      if (!/duplicate key|unique/i.test(error.message)) fail(error, "create team");
      slug = `${base}-${attempt + 1}`;
    }
    throw new Error("Could not find a free name for that team — try a slightly different one");
  }

  async updateTeam(orgId: string, teamId: string, patch: { name?: string }): Promise<void> {
    const sb = await this.sb();
    if (patch.name === undefined) return;
    const clean = patch.name.trim();
    if (!clean) throw new Error("Give the team a name");
    const { error } = await sb
      .from("teams")
      .update({ name: clean })
      .eq("org_id", orgId)
      .eq("id", teamId);
    fail(error, "rename team");
  }

  async deleteTeam(orgId: string, teamId: string): Promise<void> {
    const sb = await this.sb();
    // tasks.team_id is ON DELETE SET NULL, so tasks survive as studio-wide.
    const { error } = await sb.from("teams").delete().eq("org_id", orgId).eq("id", teamId);
    fail(error, "delete team");
  }

  async setTeamMembers(orgId: string, teamId: string, memberIds: string[]): Promise<void> {
    const sb = await this.sb();
    const wanted = [...new Set(memberIds)];

    const { data: current, error: readError } = await sb
      .from("team_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("team_id", teamId);
    fail(readError, "load team roster");

    const have = new Set(((current ?? []) as Row[]).map((r) => r.user_id as string));
    const toAdd = wanted.filter((id) => !have.has(id));
    const toRemove = [...have].filter((id) => !wanted.includes(id));

    // Only touch what actually changed — this is the edit dialog's save, and it
    // must not churn rows on every open/close.
    if (toRemove.length) {
      const { error } = await sb
        .from("team_members")
        .delete()
        .eq("org_id", orgId)
        .eq("team_id", teamId)
        .in("user_id", toRemove);
      fail(error, "remove team members");
    }
    if (toAdd.length) {
      const { error } = await sb
        .from("team_members")
        .insert(toAdd.map((userId) => ({ team_id: teamId, user_id: userId, org_id: orgId })));
      fail(error, "add team members");
    }
  }

  /* ---------------------------- availability ---------------------------- */

  async getAvailabilityStates(
    orgId: string,
    userIds: string[],
    dates: string[],
  ): Promise<Record<string, AvailabilityStates>> {
    const out: Record<string, AvailabilityStates> = Object.fromEntries(userIds.map((id) => [id, {}]));
    if (!userIds.length || !dates.length) return out;
    const sb = await this.sb();
    const { data, error } = await sb
      .from("availability")
      .select("user_id, slot_date, states, hours")
      .eq("org_id", orgId)
      .in("user_id", userIds)
      .in("slot_date", dates);
    fail(error, "load availability");
    for (const row of (data ?? []) as Row[]) {
      const map = out[row.user_id] ?? (out[row.user_id] = {});
      // Fall back to the legacy hours array for any row the backfill missed.
      const states = normaliseStates(row.states);
      map[row.slot_date] = Object.keys(states).length
        ? states
        : Object.fromEntries(((row.hours ?? []) as number[]).map((h) => [Number(h), "free" as const]));
    }
    return out;
  }

  async saveAvailabilityStates(
    orgId: string,
    userId: string,
    date: string,
    states: Record<number, SlotState>,
  ): Promise<void> {
    const sb = await this.sb();
    const entries = Object.entries(states).filter(
      ([h, v]) => Number.isInteger(Number(h)) && Number(h) >= 0 && Number(h) <= 23 && (v === "free" || v === "busy"),
    );
    if (!entries.length) {
      const { error } = await sb
        .from("availability")
        .delete()
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("slot_date", date);
      fail(error, "clear availability");
      return;
    }
    // `hours` is still written by a trigger from `states`; sending it here too
    // keeps the row correct even if the trigger is ever dropped.
    const { error } = await sb.from("availability").upsert(
      {
        org_id: orgId,
        user_id: userId,
        slot_date: date,
        states: Object.fromEntries(entries) as Record<string, SlotState>,
        hours: hoursFromStates(states),
      },
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

  /**
   * Resolve an invite link before the visitor has an account.
   *
   * `invites` is RLS-protected (admins only), so this goes through the
   * `invite_preview` security-definer RPC, which returns only the fields the
   * invite page needs — never the token list, invited_by, or audit trail.
   */
  async getInviteByToken(token: string): Promise<InviteLookup | null> {
    const sb = await this.sb();
    const { data, error } = await sb.rpc("invite_preview", { invite_token: token });
    // An unknown/expired token is a normal outcome, not an error worth a 500.
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as Row | null | undefined;
    if (!row) return null;
    return {
      orgId: row.org_id,
      orgName: row.org_name ?? null,
      email: row.email ?? null,
      role: row.role as OrgRole,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at ?? null,
    };
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

  /* ------------------------- join link + requests ------------------------ */

  /* --------------------------- weekly default --------------------------- */

  async getWeeklyDefault(orgId: string, userId: string): Promise<WeeklyDefault | null> {
    const all = await this.listWeeklyDefaults(orgId, [userId]);
    return all[userId] ?? null;
  }

  /**
   * Every teammate's usual week in one query. The dashboard folds these into
   * the dated rows so a day nobody has touched still reads as that person's
   * normal hours instead of a wall of grey.
   */
  async listWeeklyDefaults(orgId: string, userIds: string[]): Promise<Record<string, WeeklyDefault>> {
    const out: Record<string, WeeklyDefault> = {};
    if (!userIds.length) return out;
    const sb = await this.sb();
    const { data, error } = await sb
      .from("availability")
      .select("user_id, default_states")
      .eq("org_id", orgId)
      .in("user_id", userIds)
      .is("slot_date", null);
    // A missing template is a normal state, not a failure to load the page.
    if (error) return out;
    for (const row of (data ?? []) as Row[]) {
      const week = normaliseWeeklyDefault(row.default_states);
      if (Object.keys(week).length) out[row.user_id] = week;
    }
    return out;
  }

  async setWeeklyDefault(orgId: string, userId: string, week: WeeklyDefault | null): Promise<void> {
    const sb = await this.sb();
    const clean = normaliseWeeklyDefault(week);
    const payload = Object.keys(clean).length ? clean : null;
    const { error } = await sb.rpc("set_weekly_default", { target_states: payload });
    void orgId;
    void userId;
    fail(error, "save weekly default");
  }

  /* ----------------------------- task plans ----------------------------- */
  /*
   * Plans are read separately from tasks on purpose. The dashboard needs one
   * day of one team, and a task list needs none — embedding plans in the task
   * select would make every task query heavier for a view that never shows them.
   */
  async listTaskPlans(orgId: string, filters: TaskPlanFilters = {}): Promise<TaskPlan[]> {
    if (filters.userIds && !filters.userIds.length) return [];
    if (filters.dates && !filters.dates.length) return [];
    const sb = await this.sb();
    let query = sb
      .from("task_plans")
      .select("id, org_id, task_id, user_id, plan_date, start_hour, end_hour, minutes, created_at")
      .eq("org_id", orgId);
    if (filters.userIds) query = query.in("user_id", filters.userIds);
    if (filters.taskIds) query = query.in("task_id", filters.taskIds);
    if (filters.dates) query = query.in("plan_date", filters.dates);
    const { data, error } = await query;
    /*
     * A project that has not run 0011 yet should still load: the feature goes
     * quiet (no blocks drawn, planning says "not available") instead of taking
     * the dashboard down with it. Same rule as the 0010 fallback in listTasks.
     */
    if (isMissingTable(error) || isMissingSchema(error)) return [];
    fail(error, "load task plans");
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      orgId: r.org_id,
      taskId: r.task_id,
      userId: r.user_id,
      date: r.plan_date,
      startHour: Number(r.start_hour),
      endHour: Number(r.end_hour),
      minutes: Number(r.minutes ?? 0),
      createdAt: r.created_at,
    }));
  }

  async setTaskPlan(
    orgId: string,
    input: { taskId: string; userId: string; date: string; blocks: PlanBlockInput[] },
  ): Promise<void> {
    const sb = await this.sb();
    const blocks = normaliseBlocks(
      input.blocks.map((b) => ({
        ...b,
        date: input.date,
        minutes: Math.max(0, Math.round(Number(b.minutes) || 0)),
      })),
    );

    /*
     * One RPC writes the day atomically: the blocks and the availability those
     * blocks imply. Doing it in two round trips would leave a moment where the
     * team view shows a planned hour the member's calendar calls free.
     */
    const { error } = await sb.rpc("set_task_plan", {
      target_task: input.taskId,
      plan_date: input.date,
      blocks: blocks.map((b) => ({
        startHour: b.startHour,
        endHour: b.endHour,
        minutes: b.minutes,
      })),
    });
    if (isMissingTable(error) || isMissingSchema(error)) return; // no 0011 yet
    if (error) {
      /*
       * Older projects may not have the RPC but do have the table. Fall back to
       * plain writes plus an availability upsert so the feature still works.
       */
      if (!/function .*set_task_plan/i.test(error.message ?? "")) fail(error, "save task plan");
      const { error: deleteError } = await sb
        .from("task_plans")
        .delete()
        .eq("org_id", orgId)
        .eq("task_id", input.taskId)
        .eq("user_id", input.userId)
        .eq("plan_date", input.date);
      fail(deleteError, "clear task plan");
      if (blocks.length) {
        const { error: insertError } = await sb.from("task_plans").insert(
          blocks.map((b) => ({
            org_id: orgId,
            task_id: input.taskId,
            user_id: input.userId,
            plan_date: input.date,
            start_hour: b.startHour,
            end_hour: b.endHour,
            minutes: b.minutes,
          })),
        );
        fail(insertError, "save task plan");
      }
    }

    /* Mirror the blocks into availability, exactly as the RPC does. */
    if (!blocks.length) return;
    const states = await this.getAvailabilityStates(orgId, [input.userId], [input.date]);
    const merged = busyStatesForPlans(blocks, states[input.userId] ?? {});
    for (const [date, dayStates] of Object.entries(merged)) {
      await this.saveAvailabilityStates(orgId, input.userId, date, dayStates);
    }
  }

  async getJoinLink(orgId: string): Promise<JoinLink> {
    const sb = await this.sb();
    const { data, error } = await sb.rpc("ensure_join_link", { target_org: orgId });
    fail(error, "read join link");
    const row = (Array.isArray(data) ? data[0] : data) as Row;
    return {
      orgId: row.org_id,
      token: row.token,
      enabled: row.enabled,
      createdAt: row.created_at,
    };
  }

  async setJoinLinkEnabled(orgId: string, enabled: boolean): Promise<void> {
    const sb = await this.sb();
    const { error } = await sb
      .from("join_links")
      .update({ enabled })
      .eq("org_id", orgId);
    fail(error, "update join link");
  }

  async rotateJoinLink(orgId: string): Promise<JoinLink> {
    const sb = await this.sb();
    const { data, error } = await sb.rpc("rotate_join_link", { target_org: orgId });
    fail(error, "rotate join link");
    const row = (Array.isArray(data) ? data[0] : data) as Row;
    return {
      orgId: row.org_id,
      token: row.token,
      enabled: row.enabled,
      createdAt: row.created_at,
    };
  }

  async findJoinLink(token: string): Promise<{ orgId: string; orgName: string; enabled: boolean } | null> {
    const sb = await this.sb();
    const { data, error } = await sb.rpc("join_link_preview", { link_token: token });
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as Row | null | undefined;
    if (!row) return null;
    return { orgId: row.org_id, orgName: row.org_name, enabled: row.enabled };
  }

  async requestToJoin(
    token: string,
    userId: string,
    note?: string | null,
  ): Promise<{ orgId: string; alreadyPending: boolean }> {
    const sb = await this.sb();
    const { data, error } = await sb.rpc("request_to_join", {
      link_token: token,
      request_note: note ?? null,
    });
    fail(error, "send join request");
    const row = (Array.isArray(data) ? data[0] : data) as Row;
    void userId;
    return { orgId: row.org_id, alreadyPending: Boolean(row.already_pending) };
  }

  async listJoinRequests(orgId: string): Promise<JoinRequest[]> {
    const sb = await this.sb();
    const { data, error } = await sb
      .from("join_requests")
      .select("*")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    fail(error, "list join requests");
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return [];

    /*
     * The requester is not a member yet, so RLS on `profiles` hides them from a
     * plain join — which is exactly how the inbox ended up saying "No name
     * given" for everyone. 0009 adds a policy for admins with a pending
     * request; this second, defensive lookup keeps the name on screen even if
     * a project is still on 0007 (the row still shows the request, and the
     * email/name arrive as soon as the migration runs).
     */
    const { data: profiles } = await sb
      .from("profiles")
      .select("id,email,full_name,avatar_url")
      .in("id", rows.map((r) => r.user_id));
    const byId = new Map<string, Row>(((profiles ?? []) as Row[]).map((p) => [String(p.id), p]));

    return rows.map((r) => {
      const profile = byId.get(String(r.user_id));
      return {
        id: r.id,
        orgId: r.org_id,
        userId: r.user_id,
        profile: {
          id: profile?.id ?? r.user_id,
          email: profile?.email ?? "",
          fullName: profile?.full_name ?? null,
          avatarUrl: profile?.avatar_url ?? null,
        },
        note: r.note ?? null,
        status: r.status,
        createdAt: r.created_at,
        decidedAt: r.decided_at ?? null,
      };
    });
  }

  async approveJoinRequest(orgId: string, requestId: string): Promise<void> {
    const sb = await this.sb();
    const { error } = await sb.rpc("decide_join_request", {
      target_org: orgId,
      request_id: requestId,
      approve: true,
    });
    fail(error, "approve join request");
  }

  async declineJoinRequest(orgId: string, requestId: string): Promise<void> {
    const sb = await this.sb();
    const { error } = await sb.rpc("decide_join_request", {
      target_org: orgId,
      request_id: requestId,
      approve: false,
    });
    fail(error, "decline join request");
  }

  async listMyJoinRequests(userId: string): Promise<MyJoinRequest[]> {
    const sb = await this.sb();
    const { data, error } = await sb.rpc("my_join_requests");
    if (error) return [];
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      orgId: r.org_id,
      orgName: r.org_name,
      status: r.status,
      note: r.note ?? null,
      createdAt: r.created_at,
    }));
  }

  async getMyJoinRequest(orgId: string, userId: string): Promise<JoinRequest | null> {
    const sb = await this.sb();
    const { data, error } = await sb
      .from("join_requests")
      .select("*")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .maybeSingle();
    if (error || !data) return null;
    const r = data as Row;
    return {
      id: r.id,
      orgId: r.org_id,
      userId: r.user_id,
      profile: { id: r.user_id, email: "", fullName: null, avatarUrl: null },
      note: r.note ?? null,
      status: r.status,
      createdAt: r.created_at,
      decidedAt: r.decided_at ?? null,
    };
  }
}
