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
import { nextDates, todayISO } from "../dates";

export interface TaskFilters {
  assigneeId?: string;
  status?: string;
  search?: string;
  /** when set, only tasks assigned to this user (member view) */
  onlyForUser?: string;
}

/**
 * Repository contract. Two implementations:
 *  - memory.ts   (demo mode, no backend required)
 *  - supabase.ts (production, RLS-protected)
 *
 * Every method takes an explicit orgId so multi-tenancy is never implicit.
 */
export interface DataStore {
  readonly kind: "memory" | "supabase";

  // org & membership -------------------------------------------------------
  getOrg(orgId: string): Promise<Organization | null>;
  updateOrg(orgId: string, patch: { name?: string; plan?: PlanTier; seatLimit?: number }): Promise<void>;
  listMembers(orgId: string): Promise<Member[]>;
  getMembership(orgId: string, userId: string): Promise<Membership | null>;
  updateMemberRole(orgId: string, membershipId: string, role: OrgRole): Promise<void>;
  updateMemberCapacity(orgId: string, membershipId: string, capacity: number): Promise<void>;
  removeMember(orgId: string, membershipId: string): Promise<void>;

  // tasks ------------------------------------------------------------------
  listTasks(orgId: string, filters?: TaskFilters): Promise<Task[]>;
  createTask(orgId: string, input: Omit<Task, "id" | "orgId" | "createdAt">, actorId: string): Promise<Task>;
  updateTask(orgId: string, taskId: string, patch: Partial<Task>): Promise<void>;
  deleteTask(orgId: string, taskId: string): Promise<void>;

  // availability -----------------------------------------------------------
  getAvailability(orgId: string, userIds: string[], dates: string[]): Promise<Record<string, AvailabilityMap>>;
  saveAvailability(orgId: string, userId: string, date: string, hours: number[]): Promise<void>;

  // invites ----------------------------------------------------------------
  listInvites(orgId: string): Promise<Invite[]>;
  createInvite(orgId: string, email: string, role: OrgRole): Promise<Invite>;
  revokeInvite(orgId: string, inviteId: string): Promise<void>;
}

/* ==========================================================================
   Demo seed (also used by `npm run seed:demo` for Supabase previews)
   ========================================================================== */
const U = {
  owner: "11111111-1111-4111-8111-111111111111",
  admin: "22222222-2222-4222-8222-222222222222",
  testMember: "33333333-3333-4333-8333-333333333333",
  aarav: "44444444-4444-4444-8444-444444444444",
  priya: "55555555-5555-4555-8555-555555555555",
  roshan2: "66666666-6666-4666-8666-666666666666",
  neha: "77777777-7777-4777-8777-777777777777",
  kabir: "88888888-8888-4888-8888-888888888888",
} as const;

export const DEMO_ORG_ID = "99999999-9999-4999-8999-999999999999";

export const DEMO_USERS: (Profile & { role: OrgRole; capacity: number })[] = [
  { id: U.owner, email: "patelroshu1218@gmail.com", fullName: "Roshan Patel", avatarUrl: null, role: "owner", capacity: 40 },
  { id: U.admin, email: "info@cinegemstudio.in", fullName: "Cinegem Studio", avatarUrl: null, role: "admin", capacity: 40 },
  { id: U.testMember, email: "member1@demo.workpulse.io", fullName: "Test Member", avatarUrl: null, role: "member", capacity: 40 },
  { id: U.aarav, email: "aarav.shah@demo.workpulse.io", fullName: "Aarav Shah", avatarUrl: null, role: "member", capacity: 32 },
  { id: U.priya, email: "priya.mehta@demo.workpulse.io", fullName: "Priya Mehta", avatarUrl: null, role: "member", capacity: 24 },
  { id: U.roshan2, email: "roshanpatel193052005@gmail.com", fullName: "Roshan Patel", avatarUrl: null, role: "member", capacity: 40 },
  { id: U.neha, email: "neha.verma@demo.workpulse.io", fullName: "Neha Verma", avatarUrl: null, role: "member", capacity: 30 },
  { id: U.kabir, email: "kabir.rao@demo.workpulse.io", fullName: "Kabir Rao", avatarUrl: null, role: "member", capacity: 36 },
];

export interface MemoryDatabase {
  org: Organization;
  profiles: Profile[];
  memberships: Membership[];
  tasks: Task[];
  /** key: `${orgId}:${userId}` */
  availability: Record<string, AvailabilityMap>;
  invites: (Invite & { orgId: string })[];
  demoUsers: (Profile & { role: OrgRole; capacity: number })[];
}

export function seedMemory(): MemoryDatabase {
  const org: Organization = {
    id: DEMO_ORG_ID,
    name: "Cinegem Studio",
    slug: "cinegem-studio",
    plan: "pro",
    seatLimit: 25,
  };

  const profiles: Profile[] = DEMO_USERS.map(({ id, email, fullName, avatarUrl }) => ({
    id,
    email,
    fullName,
    avatarUrl,
  }));

  const memberships: Membership[] = DEMO_USERS.map((u) => ({
    id: `mem-${u.id}`,
    orgId: org.id,
    userId: u.id,
    role: u.role,
    capacity: u.capacity,
  }));

  const d = (n: number) => nextDates(Math.max(n, 0) + 1)[n] ?? todayISO();
  const tasks: Task[] = [
    { id: "t1", orgId: org.id, title: "Designing Website", client: "Qween", description: "Refer Bluestone Website — hero, pricing and case-study pages.", assigneeId: U.aarav, estHours: 12, progress: 55, status: "in_progress", priority: "high", deadline: d(2), createdAt: new Date().toISOString() },
    { id: "t2", orgId: org.id, title: "Brand Identity Refresh", client: "Bluestone", description: "Logo variants, type scale and a 12-page brand guide.", assigneeId: U.priya, estHours: 9, progress: 30, status: "in_progress", priority: "medium", deadline: d(4), createdAt: new Date().toISOString() },
    { id: "t3", orgId: org.id, title: "Landing Page Build", client: "Cinegem Studio", description: "Next.js marketing page with CMS-driven sections.", assigneeId: U.testMember, estHours: 16, progress: 10, status: "pending", priority: "high", deadline: d(6), createdAt: new Date().toISOString() },
    { id: "t4", orgId: org.id, title: "Mobile App UI", client: "Qween", description: "Onboarding flow + dashboard screens for iOS and Android.", assigneeId: U.roshan2, estHours: 20, progress: 65, status: "in_progress", priority: "high", deadline: d(3), createdAt: new Date().toISOString() },
    { id: "t5", orgId: org.id, title: "SEO Audit Report", client: "Northlight Films", description: "Technical audit with prioritised fixes and keyword gaps.", assigneeId: U.neha, estHours: 6, progress: 100, status: "done", priority: "low", deadline: d(-2), createdAt: new Date().toISOString() },
    { id: "t6", orgId: org.id, title: "Product Photoshoot Retouch", client: "Bluestone", description: "42 product shots — background cleanup and colour match.", assigneeId: U.kabir, estHours: 14, progress: 40, status: "in_progress", priority: "medium", deadline: d(5), createdAt: new Date().toISOString() },
    { id: "t7", orgId: org.id, title: "Q3 Client Deck", client: "Qween", description: "12-slide results deck with charts from the analytics export.", assigneeId: U.aarav, estHours: 5, progress: 0, status: "pending", priority: "medium", deadline: d(8), createdAt: new Date().toISOString() },
    { id: "t8", orgId: org.id, title: "Website QA Pass", client: "Cinegem Studio", description: "Cross-browser QA, accessibility checks, bug list.", assigneeId: U.testMember, estHours: 4, progress: 0, status: "pending", priority: "low", deadline: d(9), createdAt: new Date().toISOString() },
    { id: "t9", orgId: org.id, title: "Newsletter Template", client: "Northlight Films", description: "Responsive email template, dark + light variants.", assigneeId: U.neha, estHours: 3, progress: 100, status: "done", priority: "low", deadline: d(-5), createdAt: new Date().toISOString() },
    { id: "t10", orgId: org.id, title: "Pricing Page Copy", client: "Bluestone", description: "Rewrite pricing tiers and FAQ, tone: confident and plain.", assigneeId: U.priya, estHours: 4, progress: 0, status: "pending", priority: "high", deadline: d(1), createdAt: new Date().toISOString() },
  ];

  // Availability: weekday 9–5 for most, with realistic gaps.
  const dates = nextDates(14);
  const availability: Record<string, AvailabilityMap> = {};
  const patterns: Record<string, (dayIndex: number) => number[]> = {
    [U.testMember]: (i) => (i % 7 === 0 || i % 7 === 6 ? [] : [9, 10, 11, 12]),
    [U.aarav]: (i) => (i % 7 === 6 ? [] : [10, 11, 12, 13, 14]),
    [U.priya]: (i) => (i % 7 === 0 ? [] : [14, 15, 16, 17, 18]),
    [U.roshan2]: (i) => (i % 7 === 5 || i % 7 === 6 ? [] : [9, 10, 11, 12, 13, 14, 15, 16]),
    [U.neha]: (i) => (i % 3 === 0 ? [12, 13, 14] : [9, 10, 11]),
    [U.kabir]: (i) => (i % 4 === 0 ? [6, 7, 8, 9, 10] : [15, 16, 17, 18, 19]),
  };
  for (const [userId, fn] of Object.entries(patterns)) {
    const map: AvailabilityMap = {};
    dates.forEach((date, i) => {
      const hours = fn(i);
      if (hours.length) map[date] = hours;
    });
    availability[`${org.id}:${userId}`] = map;
  }

  return {
    org,
    profiles,
    memberships,
    tasks,
    availability,
    invites: [],
    demoUsers: DEMO_USERS,
  };
}
