import type {
  AvailabilityMap,
  AvailabilityStates,
  Invite,
  JoinLink,
  JoinRequest,
  Member,
  Membership,
  MyJoinRequest,
  Organization,
  OrgRole,
  PlanTier,
  Profile,
  SlotState,
  Task,
  TaskPlan,
  Team,
  WeeklyDefault,
} from "../types";
import { nextDates, todayISO } from "../dates";
import { statesFromHours } from "../availability";

/**
 * What an invite link needs to show before the visitor has an account:
 * the team they're joining, the role, and which email it was sent to.
 */
export interface InviteLookup {
  orgId: string;
  orgName: string | null;
  email: string | null;
  role: OrgRole;
  expiresAt: string;
  acceptedAt: string | null;
}

export interface TaskFilters {
  assigneeId?: string;
  status?: string;
  search?: string;
  /** when set, only tasks assigned to this user (member view) */
  onlyForUser?: string;
  /** when set, only tasks on this team (team dashboard) */
  teamId?: string;
}

/** A block as the editor sends it — no ids, the store owns those. */
export interface PlanBlockInput {
  startHour: number;
  endHour: number;
  /** Effort inside the block, in minutes. */
  minutes: number;
}

export interface TaskPlanFilters {
  userIds?: string[];
  taskIds?: string[];
  /** YYYY-MM-DD, inclusive window. */
  dates?: string[];
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
  /** Every studio this user belongs to — drives the studio switcher. */
  listOrgsForUser(userId: string): Promise<Organization[]>;
  /** The raw membership rows (role + createdAt), newest first for the session. */
  listMembershipsForUser(userId: string): Promise<Membership[]>;
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

  // teams ------------------------------------------------------------------
  listTeams(orgId: string): Promise<Team[]>;
  createTeam(orgId: string, name: string, memberIds: string[]): Promise<Team>;
  updateTeam(orgId: string, teamId: string, patch: { name?: string }): Promise<void>;
  deleteTeam(orgId: string, teamId: string): Promise<void>;
  /** Replace the whole roster in one go — the edit dialog sends a set. */
  setTeamMembers(orgId: string, teamId: string, memberIds: string[]): Promise<void>;

  // availability -----------------------------------------------------------
  /** @deprecated legacy shape; use getAvailabilityStates */
  getAvailability(orgId: string, userIds: string[], dates: string[]): Promise<Record<string, AvailabilityMap>>;
  /** @deprecated legacy shape; use saveAvailabilityStates */
  saveAvailability(orgId: string, userId: string, date: string, hours: number[]): Promise<void>;

  /** Tri-state availability for a set of people across a set of dates. */
  getAvailabilityStates(orgId: string, userIds: string[], dates: string[]): Promise<Record<string, AvailabilityStates>>;
  /** Persist one day of tri-state availability. Empty map deletes the row. */
  saveAvailabilityStates(orgId: string, userId: string, date: string, states: Record<number, SlotState>): Promise<void>;

  // invites ----------------------------------------------------------------
  listInvites(orgId: string): Promise<Invite[]>;
  /** Public-ish lookup by link token. Returns null when unknown/expired/used. */
  getInviteByToken(token: string): Promise<InviteLookup | null>;
  createInvite(orgId: string, email: string, role: OrgRole): Promise<Invite>;
  revokeInvite(orgId: string, inviteId: string): Promise<void>;

  // join link + requests ---------------------------------------------------
  /** The studio's single shareable link, created on first read. */
  getJoinLink(orgId: string): Promise<JoinLink>;
  /** Turn the common link on/off without changing its token. */
  setJoinLinkEnabled(orgId: string, enabled: boolean): Promise<void>;
  /** Rotate the token — every previously shared link stops working. */
  rotateJoinLink(orgId: string): Promise<JoinLink>;
  /** Resolve a join link by token for the public landing page. */
  findJoinLink(token: string): Promise<{ orgId: string; orgName: string; enabled: boolean } | null>;
  /** The signed-in person asks to join. Idempotent while a request is pending. */
  requestToJoin(token: string, userId: string, note?: string | null): Promise<{ orgId: string; alreadyPending: boolean }>;
  /** Admin inbox. `pending` only, oldest first. */
  listJoinRequests(orgId: string): Promise<JoinRequest[]>;
  /** Approve: creates the membership as a member. Returns the userId admitted. */
  approveJoinRequest(orgId: string, requestId: string): Promise<void>;
  declineJoinRequest(orgId: string, requestId: string): Promise<void>;
  /** The signed-in person's outstanding request, for the "waiting" screen. */
  getMyJoinRequest(orgId: string, userId: string): Promise<JoinRequest | null>;
  /**
   * Every studio the signed-in person is waiting on.
   *
   * A requester is not a member, so `organizations` is invisible to them and
   * `getMyJoinRequest` needs an org id they may not know. This is the lookup
   * that lets the join page — and onboarding — say "you already asked X".
   */
  listMyJoinRequests(userId: string): Promise<MyJoinRequest[]>;

  // weekly default ---------------------------------------------------------
  /** The member's reusable week, or null when they haven't set one. */
  getWeeklyDefault(orgId: string, userId: string): Promise<WeeklyDefault | null>;
  /**
   * The same template for many people in one round trip, keyed by user id.
   * Days a person has explicitly dated always win over this — use
   * `applyWeeklyDefault` to merge the two.
   */
  listWeeklyDefaults(orgId: string, userIds: string[]): Promise<Record<string, WeeklyDefault>>;
  /** Replace (or, with null, clear) the template. Dated days are never touched. */
  setWeeklyDefault(orgId: string, userId: string, week: WeeklyDefault | null): Promise<void>;

  // task plans --------------------------------------------------------------
  /**
   * The blocks a set of people has planned across a window of days. Every
   * filter is optional; the dashboard asks for one day and one team, the
   * member's own page for one person and both weeks.
   */
  listTaskPlans(orgId: string, filters?: TaskPlanFilters): Promise<TaskPlan[]>;
  /**
   * Replace one person's blocks for one task on one day. Touching blocks are
   * merged first, so "2–4 and 4–6" is stored as "2–6" and the grid has one long
   * bar to paint rather than two it would have to stitch together.
   */
  setTaskPlan(
    orgId: string,
    input: { taskId: string; userId: string; date: string; blocks: PlanBlockInput[] },
  ): Promise<void>;
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
  /**
   * Two accounts that exist in auth but have no membership in Cinegem:
   *
   *   joiner    fresh signup — no studio at all, exactly the state that used to
   *             be pushed into "create a studio" right after asking to join.
   *   elsewhere owns a tiny studio of their own, so signing in with it shows the
   *             studio switcher instead of silently picking one.
   */
  joiner: "aaaaaaaa-1111-4111-8111-111111111111",
  elsewhere: "bbbbbbbb-2222-4222-8222-222222222222",
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
  /*
   * Not in Cinegem yet — `seedMemory` deliberately skips them when it builds
   * memberships. They exist so the join flow can be walked through locally
   * (ask → waiting → approved) without a Supabase project.
   */
  { id: U.joiner, email: "new.joiner@demo.workpulse.io", fullName: "New Joiner", avatarUrl: null, role: "member", capacity: 40 },
  { id: U.elsewhere, email: "two.studios@demo.workpulse.io", fullName: "Sam Two-Studios", avatarUrl: null, role: "member", capacity: 40 },
];

/**
 * Demo accounts that intentionally have no membership in the main studio.
 *
 * `elsewhere` is *not* in this list: it belongs to both studios, which is the
 * case that used to open the wrong one ("signed in with my admin email and got
 * the empty studio I made earlier").
 */
export const DEMO_OUTSIDERS: string[] = [U.joiner];

/** Studio ids used by the demo seed (a second, empty one for the switcher). */
export const DEMO_SECOND_ORG_ID = "88888888-8888-4888-8888-888888888888";

export interface MemoryDatabase {
  org: Organization;
  /** Every studio in the demo, `org` included. */
  orgs: Organization[];
  profiles: Profile[];
  memberships: Membership[];
  teams: Team[];
  tasks: Task[];
  /** key: `${orgId}:${userId}` — legacy hours shape, kept in sync */
  availability: Record<string, AvailabilityMap>;
  /** key: `${orgId}:${userId}` — tri-state source of truth */
  availabilityStates: Record<string, Record<string, Record<number, SlotState>>>;
  invites: (Invite & { orgId: string })[];
  joinLinks: Record<string, JoinLink & { orgName: string }>;
  joinRequests: JoinRequest[];
  /** key: `${orgId}:${userId}` */
  weeklyDefaults: Record<string, WeeklyDefault>;
  /** One entry per planned block; see `setTaskPlan` for the shape. */
  taskPlans: TaskPlan[];
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

  const secondOrg: Organization = {
    id: DEMO_SECOND_ORG_ID,
    name: "Two-Studios Design",
    slug: "two-studios-design",
    plan: "free",
    seatLimit: 5,
  };

  const seededAt = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const memberships: Membership[] = DEMO_USERS.filter((u) => !DEMO_OUTSIDERS.includes(u.id)).map((u) => ({
    id: `mem-${u.id}`,
    orgId: org.id,
    userId: u.id,
    role: u.role,
    capacity: u.capacity,
    createdAt: seededAt,
  }));

  /*
   * The two-studio account: it owns a small studio of its own and was approved
   * into Cinegem *later*. The later membership is the one a sign-in should
   * open — the account was last doing something in Cinegem, and the studio it
   * made first is empty.
   */
  memberships.push({
    id: `mem-${U.elsewhere}-own`,
    orgId: secondOrg.id,
    userId: U.elsewhere,
    role: "owner",
    capacity: 40,
    // Older than the seeded Cinegem rows above, so "newest wins" is honest.
    createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  });

  // Declared before the tasks so each task's teamId refers to something real.
  const TEAM_WEB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const TEAM_BRAND_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

  const d = (n: number) => nextDates(Math.max(n, 0) + 1)[n] ?? todayISO();
  const tasks: Task[] = [
    { id: "t1", orgId: org.id, title: "Designing Website", client: "Qween", description: "Refer Bluestone Website — hero, pricing and case-study pages.", assigneeId: U.aarav, teamId: TEAM_WEB_ID, estHours: 12, progress: 55, status: "in_progress", priority: "high", deadline: d(2), startDate: d(0), dueTime: "10:00", createdAt: new Date().toISOString() },
    { id: "t2", orgId: org.id, title: "Brand Identity Refresh", client: "Bluestone", description: "Logo variants, type scale and a 12-page brand guide.", assigneeId: U.priya, teamId: TEAM_BRAND_ID, estHours: 9, progress: 30, status: "in_progress", priority: "medium", deadline: d(4), startDate: d(2), dueTime: "14:00", createdAt: new Date().toISOString() },
    { id: "t3", orgId: org.id, title: "Landing Page Build", client: "Cinegem Studio", description: "Next.js marketing page with CMS-driven sections.", assigneeId: U.testMember, teamId: null, estHours: 16, progress: 10, status: "pending", priority: "high", deadline: d(6), startDate: d(4), dueTime: "16:00", createdAt: new Date().toISOString() },
    { id: "t4", orgId: org.id, title: "Mobile App UI", client: "Qween", description: "Onboarding flow + dashboard screens for iOS and Android.", assigneeId: U.roshan2, teamId: TEAM_BRAND_ID, estHours: 20, progress: 65, status: "in_progress", priority: "high", deadline: d(3), startDate: d(1), dueTime: "17:30", createdAt: new Date().toISOString() },
    { id: "t5", orgId: org.id, title: "SEO Audit Report", client: "Northlight Films", description: "Technical audit with prioritised fixes and keyword gaps.", assigneeId: U.neha, teamId: TEAM_WEB_ID, estHours: 6, progress: 100, status: "done", priority: "low", deadline: d(-2), startDate: d(-2), dueTime: "10:00", createdAt: new Date().toISOString() },
    { id: "t6", orgId: org.id, title: "Product Photoshoot Retouch", client: "Bluestone", description: "42 product shots — background cleanup and colour match.", assigneeId: U.kabir, teamId: TEAM_BRAND_ID, estHours: 14, progress: 40, status: "in_progress", priority: "medium", deadline: d(5), startDate: d(3), dueTime: "18:00", createdAt: new Date().toISOString() },
    { id: "t7", orgId: org.id, title: "Q3 Client Deck", client: "Qween", description: "12-slide results deck with charts from the analytics export.", assigneeId: U.aarav, assigneeIds: [U.aarav, U.neha], teamId: TEAM_WEB_ID, estHours: 5, progress: 0, status: "pending", priority: "medium", deadline: d(8), startDate: d(6), dueTime: "17:30", createdAt: new Date().toISOString() },
    { id: "t8", orgId: org.id, title: "Website QA Pass", client: "Cinegem Studio", description: "Cross-browser QA, accessibility checks, bug list.", assigneeId: U.testMember, teamId: null, estHours: 4, progress: 0, status: "pending", priority: "low", deadline: d(9), startDate: d(7), dueTime: "13:00", createdAt: new Date().toISOString() },
    { id: "t9", orgId: org.id, title: "Newsletter Template", client: "Northlight Films", description: "Responsive email template, dark + light variants.", assigneeId: U.neha, teamId: TEAM_WEB_ID, estHours: 3, progress: 100, status: "done", priority: "low", deadline: d(-5), startDate: d(-5), dueTime: "16:00", createdAt: new Date().toISOString() },
    { id: "t10", orgId: org.id, title: "Pricing Page Copy", client: "Bluestone", description: "Rewrite pricing tiers and FAQ, tone: confident and plain.", assigneeId: U.priya, teamId: TEAM_BRAND_ID, estHours: 4, progress: 0, status: "pending", priority: "high", deadline: d(1), startDate: d(-1), dueTime: "11:00", createdAt: new Date().toISOString() },
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
  const availabilityStates: Record<string, Record<string, Record<number, SlotState>>> = {};
  for (const [userId, fn] of Object.entries(patterns)) {
    const map: AvailabilityMap = {};
    const tri: Record<string, Record<number, SlotState>> = {};
    dates.forEach((date, i) => {
      const hours = fn(i);
      if (!hours.length) return;
      map[date] = hours;
      // Seed a few explicit "busy" hours so the demo shows all three states,
      // not just free/unassigned.
      const states = statesFromHours(hours);
      if (i % 2 === 0) for (let h = 18; h <= 20; h++) states[h] = "busy";
      tri[date] = states;
    });
    availability[`${org.id}:${userId}`] = map;
    availabilityStates[`${org.id}:${userId}`] = tri;
  }

  // Two teams, so the dashboard switcher has something real to switch between.
  const now = new Date().toISOString();
  const teams: Team[] = [
    {
      id: TEAM_WEB_ID,
      orgId: org.id,
      name: "Web",
      slug: "web",
      memberIds: [U.aarav, U.neha],
      createdAt: now,
    },
    {
      id: TEAM_BRAND_ID,
      orgId: org.id,
      name: "Branding",
      slug: "branding",
      memberIds: [U.priya, U.kabir, U.roshan2],
      createdAt: now,
    },
  ];

  /*
   * A couple of planned blocks, so the demo shows the feature the moment it is
   * opened: Aarav is on "Designing Website" 10–2 today and Priya is on "Brand
   * Identity Refresh" 2–6 tomorrow. The availability above already says busy
   * for some of those hours, which is the "planned over busy" case the grid has
   * to render — deliberately, so that state is never only theoretical.
   */
  const planBlocks = (userId: string, task: Task, day: string, blocks: [number, number, number][]) =>
    blocks.map(([startHour, endHour, minutes], index) => ({
      id: `plan-${task.id}-${index}`,
      orgId: org.id,
      taskId: task.id,
      userId,
      date: day,
      startHour,
      endHour,
      minutes,
      createdAt: now,
    }));
  const taskPlans: TaskPlan[] = [
    ...planBlocks(U.aarav, tasks[0], dates[0], [[10, 12, 120], [12, 14, 120]]),
    ...planBlocks(U.priya, tasks[1], dates[1], [[14, 18, 180]]),
  ];

  return {
    org,
    orgs: [org, secondOrg],
    profiles,
    memberships,
    teams,
    tasks,
    availability,
    availabilityStates,
    invites: [],
    // Seeded so the share flow is demoable without creating one first.
    weeklyDefaults: {},
    taskPlans,
    joinLinks: {
      [org.id]: {
        orgId: org.id,
        token: "demo-join-link-token",
        enabled: true,
        createdAt: now,
        orgName: org.name,
      },
    },
    joinRequests: [],
    demoUsers: DEMO_USERS,
  };
}
