import "server-only";
import { randomUUID } from "node:crypto";
import type { AvailabilityMap, Invite, Member, Membership, OrgRole, Organization, PlanTier, Profile, Task } from "../types";
import { PLANS } from "../types";
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
    return db().org.id === orgId ? { ...db().org } : null;
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
    if (filters.onlyForUser) rows = rows.filter((t) => t.assigneeId === filters.onlyForUser);
    if (filters.assigneeId) rows = rows.filter((t) => t.assigneeId === filters.assigneeId);
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
