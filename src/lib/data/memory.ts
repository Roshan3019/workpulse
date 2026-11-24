import "server-only";
import { randomUUID } from "node:crypto";
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
  Team,
  WeeklyDefault,
} from "../types";
import { hoursFromStates, normaliseWeeklyDefault, statesFromHours } from "../availability";
import { PLANS, assigneesOf } from "../types";
import { seedMemory, type MemoryDatabase } from "./types";
import type { DataStore, InviteLookup, TaskFilters } from "./types";

/**
 * In-memory store used by demo mode. Kept on globalThis so Next's dev
 * hot-reload doesn't wipe the sample data between requests.
 */
const GLOBAL_KEY = "__workpulse_memory_db__";

function db(): MemoryDatabase {
  const g = globalThis as unknown as Record<string, MemoryDatabase | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = seedMemory();
  return g[GLOBAL_KEY]!;
}

export function resetMemoryDatabase(): void {
  const g = globalThis as unknown as Record<string, MemoryDatabase | undefined>;
  g[GLOBAL_KEY] = seedMemory();
}

function profileOf(id: string): Profile {
  const p = db().profiles.find((x) => x.id === id);
  return p ?? { id, email: "unknown@workpulse.local", fullName: "Unknown", avatarUrl: null };
}

function toMember(m: Membership): Member {
  return { ...m, profile: profileOf(m.userId) };
}

export class MemoryStore implements DataStore {
  readonly kind = "memory" as const;

  async getOrg(orgId: string): Promise<Organization | null> {
    const d = db();
    /*
     * Demo mode can hold more than one studio — the seed ships an empty second
     * one so the account switcher has something to switch to, and so the
     * "I asked to join, don't make me create a studio" flow can be walked
     * through locally.
     */
    const org = (d.org.id === orgId ? d.org : d.orgs.find((o) => o.id === orgId)) ?? null;
    return org ? { ...org } : null;
  }

  async listOrgsForUser(userId: string): Promise<Organization[]> {
    const d = db();
    const ids = new Set(d.memberships.filter((m) => m.userId === userId).map((m) => m.orgId));
    return d.orgs.filter((o) => ids.has(o.id)).map((o) => ({ ...o }));
  }

  async updateOrg(orgId: string, patch: { name?: string; plan?: PlanTier; seatLimit?: number }): Promise<void> {
    if (db().org.id !== orgId) throw new Error("Organization not found");
    if (patch.name) db().org.name = patch.name;
    if (patch.plan) {
      db().org.plan = patch.plan;
      db().org.seatLimit = patch.seatLimit ?? PLANS[patch.plan].seats;
    } else if (patch.seatLimit) {
      db().org.seatLimit = patch.seatLimit;
    }
  }

  async listMembershipsForUser(userId: string): Promise<Membership[]> {
    return db().memberships.filter((m) => m.userId === userId).map((m) => ({ ...m }));
  }

  async listMembers(orgId: string): Promise<Member[]> {
    return db()
      .memberships.filter((m) => m.orgId === orgId)
      .map(toMember)
      .sort((a, b) => {
        const rank: Record<OrgRole, number> = { owner: 0, admin: 1, member: 2 };
        return rank[a.role] - rank[b.role] || (a.profile.fullName ?? "").localeCompare(b.profile.fullName ?? "");
      });
  }

  async getMembership(orgId: string, userId: string): Promise<Membership | null> {
    return db().memberships.find((m) => m.orgId === orgId && m.userId === userId) ?? null;
  }

  /* `addMembership` lives above, next to role changes: both write `memberships`. */

  async addMembership(orgId: string, userId: string, role: OrgRole, capacity = 40): Promise<Membership> {
    const d = db();
    const existing = d.memberships.find((m) => m.orgId === orgId && m.userId === userId);
    if (existing) return existing;
    const membership: Membership = {
      id: `mem-${userId}-${orgId.slice(0, 8)}`,
      orgId,
      userId,
      role,
      capacity,
      createdAt: new Date().toISOString(),
    };
    d.memberships.push(membership);
    return membership;
  }

  async updateMemberRole(orgId: string, membershipId: string, role: OrgRole): Promise<void> {
    const m = db().memberships.find((x) => x.orgId === orgId && x.id === membershipId);
    if (!m) throw new Error("Member not found");
    if (m.role === "owner" && role !== "owner") {
      const owners = db().memberships.filter((x) => x.orgId === orgId && x.role === "owner");
      if (owners.length <= 1) throw new Error("An organization must keep at least one owner");
    }
    m.role = role;
    // Demoting to admin/owner removes availability eligibility (mirrors DB trigger).
    if (role !== "member") delete db().availability[`${orgId}:${m.userId}`];
  }

  async updateMemberCapacity(orgId: string, membershipId: string, capacity: number): Promise<void> {
    const m = db().memberships.find((x) => x.orgId === orgId && x.id === membershipId);
    if (!m) throw new Error("Member not found");
    m.capacity = capacity;
  }

  async removeMember(orgId: string, membershipId: string): Promise<void> {
    const list = db().memberships;
    const idx = list.findIndex((x) => x.orgId === orgId && x.id === membershipId);
    if (idx === -1) throw new Error("Member not found");
    const target = list[idx];
    if (target.role === "owner") throw new Error("Transfer ownership before removing the owner");
    list.splice(idx, 1);
    db().tasks.forEach((t) => {
      if (t.assigneeId === target.userId) t.assigneeId = null;
    });
    delete db().availability[`${orgId}:${target.userId}`];
  }

  async listTasks(orgId: string, filters: TaskFilters = {}): Promise<Task[]> {
    let rows = db().tasks.filter((t) => t.orgId === orgId);
    /*
     * "Assigned to me" means on the task, not only the lead. A shared task has
     * more than one person on it, and both of them must see it in their own
     * list — that is the whole point of assigning it to two people.
     */
    if (filters.onlyForUser) rows = rows.filter((t) => assigneesOf(t).includes(filters.onlyForUser!));
    if (filters.assigneeId) rows = rows.filter((t) => assigneesOf(t).includes(filters.assigneeId!));
    if (filters.teamId) rows = rows.filter((t) => t.teamId === filters.teamId);
    if (filters.status && filters.status !== "all") rows = rows.filter((t) => t.status === filters.status);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((t) =>
        `${t.title} ${t.client} ${t.description ?? ""}`.toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => {
      if (a.status === "done" && b.status !== "done") return 1;
      if (b.status === "done" && a.status !== "done") return -1;
      return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
    });
  }

  async createTask(orgId: string, input: Omit<Task, "id" | "orgId" | "createdAt">, _actorId: string): Promise<Task> {
    const task: Task = { ...input, id: randomUUID(), orgId, createdAt: new Date().toISOString() };
    db().tasks.unshift(task);
    return task;
  }

  async updateTask(orgId: string, taskId: string, patch: Partial<Task>): Promise<void> {
    const t = db().tasks.find((x) => x.orgId === orgId && x.id === taskId);
    if (!t) throw new Error("Task not found");
    Object.assign(t, patch);
  }

  async deleteTask(orgId: string, taskId: string): Promise<void> {
    const list = db().tasks;
    const i = list.findIndex((x) => x.orgId === orgId && x.id === taskId);
    if (i >= 0) list.splice(i, 1);
  }

  async getAvailability(
    orgId: string,
    userIds: string[],
    dates: string[],
  ): Promise<Record<string, AvailabilityMap>> {
    const out: Record<string, AvailabilityMap> = {};
    for (const userId of userIds) {
      const stored = db().availability[`${orgId}:${userId}`] ?? {};
      const map: AvailabilityMap = {};
      for (const date of dates) if (stored[date]?.length) map[date] = [...stored[date]];
      out[userId] = map;
    }
    return out;
  }

  async saveAvailability(orgId: string, userId: string, date: string, hours: number[]): Promise<void> {
    const membership = db().memberships.find((m) => m.orgId === orgId && m.userId === userId);
    if (!membership) throw new Error("Not a member of this organization");
    if (membership.role !== "member") throw new Error("Availability is only tracked for members");
    const key = `${orgId}:${userId}`;
    const map = (db().availability[key] ??= {});
    const clean = [...new Set(hours)].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b);
    if (clean.length) map[date] = clean;
    else delete map[date];
  }

  /* ------------------------------- teams ------------------------------- */

  async listTeams(orgId: string): Promise<Team[]> {
    return db().teams.filter((t) => t.orgId === orgId);
  }

  async createTeam(orgId: string, name: string, memberIds: string[]): Promise<Team> {
    const clean = name.trim();
    if (!clean) throw new Error("Give the team a name");
    const existing = db().teams.filter((t) => t.orgId === orgId);
    const base = slugify(clean) || "team";
    let slug = base;
    let n = 1;
    while (existing.some((t) => t.slug === slug)) slug = `${base}-${++n}`;

    const team: Team = {
      id: randomUUID(),
      orgId,
      name: clean,
      slug,
      memberIds: [...new Set(memberIds)],
      createdAt: new Date().toISOString(),
    };
    db().teams.push(team);
    return team;
  }

  async updateTeam(orgId: string, teamId: string, patch: { name?: string }): Promise<void> {
    const team = db().teams.find((t) => t.orgId === orgId && t.id === teamId);
    if (!team) throw new Error("Team not found");
    if (patch.name !== undefined) {
      const clean = patch.name.trim();
      if (!clean) throw new Error("Give the team a name");
      team.name = clean;
    }
  }

  async deleteTeam(orgId: string, teamId: string): Promise<void> {
    const d = db();
    d.teams = d.teams.filter((t) => !(t.orgId === orgId && t.id === teamId));
    // Mirror ON DELETE SET NULL: tasks survive as studio-wide.
    for (const task of d.tasks) if (task.teamId === teamId) task.teamId = null;
  }

  async setTeamMembers(orgId: string, teamId: string, memberIds: string[]): Promise<void> {
    const team = db().teams.find((t) => t.orgId === orgId && t.id === teamId);
    if (!team) throw new Error("Team not found");
    for (const userId of memberIds) {
      if (!db().memberships.some((m) => m.orgId === orgId && m.userId === userId)) {
        throw new Error("That person is not a member of this studio");
      }
    }
    team.memberIds = [...new Set(memberIds)];
  }

  /* ---------------------------- availability ---------------------------- */

  async getAvailabilityStates(
    orgId: string,
    userIds: string[],
    dates: string[],
  ): Promise<Record<string, AvailabilityStates>> {
    const out: Record<string, AvailabilityStates> = {};
    for (const userId of userIds) {
      const stored = db().availabilityStates[`${orgId}:${userId}`] ?? {};
      const map: AvailabilityStates = {};
      for (const date of dates) if (stored[date] && Object.keys(stored[date]).length) map[date] = { ...stored[date] };
      out[userId] = map;
    }
    return out;
  }

  async saveAvailabilityStates(
    orgId: string,
    userId: string,
    date: string,
    states: Record<number, SlotState>,
  ): Promise<void> {
    const membership = db().memberships.find((m) => m.orgId === orgId && m.userId === userId);
    if (!membership) throw new Error("Not a member of this organization");
    if (membership.role !== "member") throw new Error("Availability is only tracked for members");
    const key = `${orgId}:${userId}`;
    const store = (db().availabilityStates[key] ??= {});
    const clean = Object.fromEntries(
      Object.entries(states).filter(([h, v]) => Number(h) >= 0 && Number(h) <= 23 && (v === "free" || v === "busy")),
    ) as Record<number, SlotState>;
    if (Object.keys(clean).length) store[date] = clean;
    else delete store[date];
    // Keep the legacy map in step so older read paths stay correct.
    const legacy = (db().availability[key] ??= {});
    const hours = hoursFromStates(clean);
    if (hours.length) legacy[date] = hours;
    else delete legacy[date];
  }

  /* ------------------------- join link + requests ------------------------ */

  async getJoinLink(orgId: string): Promise<JoinLink> {
    const d = db();
    const existing = d.joinLinks[orgId];
    if (existing) return existing;
    const created: JoinLink & { orgName: string } = {
      orgId,
      token: randomUUID().replace(/-/g, ""),
      enabled: true,
      createdAt: new Date().toISOString(),
      orgName: d.org.id === orgId ? d.org.name : "Studio",
    };
    d.joinLinks[orgId] = created;
    return created;
  }

  async setJoinLinkEnabled(orgId: string, enabled: boolean): Promise<void> {
    const link = await this.getJoinLink(orgId);
    const stored = db().joinLinks[orgId];
    if (!stored) return;
    stored.enabled = enabled;
    void link;
  }

  async rotateJoinLink(orgId: string): Promise<JoinLink> {
    const d = db();
    const previous = await this.getJoinLink(orgId);
    const orgName = (d.joinLinks[orgId]?.orgName ?? (d.org.id === orgId ? d.org.name : "Studio"));
    const next: JoinLink & { orgName: string } = {
      ...previous,
      orgName,
      token: randomUUID().replace(/-/g, ""),
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    d.joinLinks[orgId] = next;
    return next;
  }

  async findJoinLink(token: string): Promise<{ orgId: string; orgName: string; enabled: boolean } | null> {
    const link = Object.values(db().joinLinks).find((l) => l.token === token);
    if (!link) return null;
    return { orgId: link.orgId, orgName: link.orgName, enabled: link.enabled };
  }

  async requestToJoin(
    token: string,
    userId: string,
    note?: string | null,
  ): Promise<{ orgId: string; alreadyPending: boolean }> {
    const link = await this.findJoinLink(token);
    if (!link) throw new Error("This link is no longer valid");
    if (!link.enabled) throw new Error("This link is turned off");
    const d = db();
    if (d.memberships.some((m) => m.orgId === link.orgId && m.userId === userId)) {
      throw new Error("You're already in this studio");
    }
    const pending = d.joinRequests.find(
      (r) => r.orgId === link.orgId && r.userId === userId && r.status === "pending",
    );
    if (pending) return { orgId: link.orgId, alreadyPending: true };

    const profile = d.profiles.find((p) => p.id === userId);
    d.joinRequests.push({
      id: randomUUID(),
      orgId: link.orgId,
      userId,
      profile: profile ?? { id: userId, email: "", fullName: null, avatarUrl: null },
      note: note?.trim() || null,
      status: "pending",
      createdAt: new Date().toISOString(),
      decidedAt: null,
    });
    return { orgId: link.orgId, alreadyPending: false };
  }

  async listJoinRequests(orgId: string): Promise<JoinRequest[]> {
    return db()
      .joinRequests.filter((r) => r.orgId === orgId && r.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async approveJoinRequest(orgId: string, requestId: string): Promise<void> {
    const d = db();
    const request = d.joinRequests.find((r) => r.orgId === orgId && r.id === requestId);
    if (!request || request.status !== "pending") throw new Error("That request is no longer open");
    if (d.memberships.some((m) => m.orgId === orgId && m.userId === request.userId)) {
      throw new Error("They're already in this studio");
    }
    if (d.memberships.filter((m) => m.orgId === orgId).length >= d.org.seatLimit) {
      throw new Error("This studio has reached its seat limit. Upgrade the plan first.");
    }
    d.memberships.push({
      id: randomUUID(),
      orgId,
      userId: request.userId,
      role: "member",
      capacity: 40,
    });
    request.status = "approved";
    request.decidedAt = new Date().toISOString();
  }

  async declineJoinRequest(orgId: string, requestId: string): Promise<void> {
    const request = db().joinRequests.find((r) => r.orgId === orgId && r.id === requestId);
    if (!request || request.status !== "pending") throw new Error("That request is no longer open");
    request.status = "declined";
    request.decidedAt = new Date().toISOString();
  }

  async getMyJoinRequest(orgId: string, userId: string): Promise<JoinRequest | null> {
    return (
      db().joinRequests.find((r) => r.orgId === orgId && r.userId === userId && r.status === "pending") ?? null
    );
  }

  async listMyJoinRequests(userId: string): Promise<MyJoinRequest[]> {
    const d = db();
    return d.joinRequests
      .filter((r) => r.userId === userId && r.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => ({
        id: r.id,
        orgId: r.orgId,
        orgName: d.joinLinks[r.orgId]?.orgName ?? (d.org.id === r.orgId ? d.org.name : "a studio"),
        status: r.status,
        note: r.note,
        createdAt: r.createdAt,
      }));
  }

  /* --------------------------- weekly default --------------------------- */

  async getWeeklyDefault(orgId: string, userId: string): Promise<WeeklyDefault | null> {
    return db().weeklyDefaults[`${orgId}:${userId}`] ?? null;
  }

  async listWeeklyDefaults(orgId: string, userIds: string[]): Promise<Record<string, WeeklyDefault>> {
    const out: Record<string, WeeklyDefault> = {};
    for (const userId of userIds) {
      const week = db().weeklyDefaults[`${orgId}:${userId}`];
      if (week && Object.keys(week).length) out[userId] = week;
    }
    return out;
  }

  async setWeeklyDefault(orgId: string, userId: string, week: WeeklyDefault | null): Promise<void> {
    const membership = db().memberships.find((m) => m.orgId === orgId && m.userId === userId);
    if (!membership) throw new Error("Not a member of this organization");
    if (membership.role !== "member") throw new Error("Availability is only tracked for members");
    const key = `${orgId}:${userId}`;
    const clean = normaliseWeeklyDefault(week);
    if (Object.keys(clean).length) db().weeklyDefaults[key] = clean;
    else delete db().weeklyDefaults[key];
  }

  async listInvites(orgId: string): Promise<Invite[]> {
    return db()
      .invites.filter((i) => i.orgId === orgId && !i.acceptedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getInviteByToken(token: string): Promise<InviteLookup | null> {
    const inv = db().invites.find((i) => i.token === token);
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date().toISOString()) return null;
    return {
      orgId: inv.orgId,
      orgName: db().org.id === inv.orgId ? db().org.name : null,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
    };
  }

  async createInvite(orgId: string, email: string, role: OrgRole): Promise<Invite> {
    const org = db().org;
    if (org.seatLimit <= db().memberships.filter((m) => m.orgId === orgId).length) {
      throw new Error(`Seat limit reached (${org.seatLimit}). Upgrade the plan to invite more people.`);
    }
    const invite = {
      id: randomUUID(),
      orgId,
      email: email || null,
      role,
      token: randomUUID().replace(/-/g, ""),
      expiresAt: new Date(Date.now() + 14 * 864e5).toISOString(),
      acceptedAt: null,
      createdAt: new Date().toISOString(),
    };
    db().invites.push(invite);
    return invite;
  }

  async revokeInvite(orgId: string, inviteId: string): Promise<void> {
    const list = db().invites;
    const i = list.findIndex((x) => x.orgId === orgId && x.id === inviteId);
    if (i >= 0) list.splice(i, 1);
  }

  /* demo-only helpers ---------------------------------------------------- */
  async findDemoUser(id: string) {
    return db().demoUsers.find((u) => u.id === id) ?? null;
  }
  async listDemoUsers() {
    return db().demoUsers;
  }
  async acceptDemoInvite(token: string) {
    const inv = db().invites.find((i) => i.token === token);
    if (!inv) throw new Error("Invite not found");
    inv.acceptedAt = new Date().toISOString();
    return inv;
  }
}

/** Kept in step with the Supabase store's slug rules. */
function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
