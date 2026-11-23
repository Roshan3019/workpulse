/** Shared domain types + plan definitions. Imported by server and client code. */

export type OrgRole = "owner" | "admin" | "member";
export type TaskStatus = "pending" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";
export type PlanTier = "free" | "pro" | "business";

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  done: "Done",
};

export interface Profile {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: PlanTier;
  seatLimit: number;
}

export interface Membership {
  id: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  capacity: number;
}

export interface Member extends Membership {
  profile: Profile;
}

export interface Task {
  id: string;
  orgId: string;
  title: string;
  client: string;
  description: string | null;
  assigneeId: string | null;
  estHours: number;
  progress: number;
  status: TaskStatus;
  priority: TaskPriority;
  /** Due date, YYYY-MM-DD (kept for compatibility with older rows). */
  deadline: string | null;
  /** Optional day work starts, YYYY-MM-DD. */
  startDate: string | null;
  /** Optional exact due time, HH:MM (24h). Together with `deadline` this is the due minute. */
  dueTime: string | null;
  /** The team this work belongs to. Null = studio-wide (created before teams). */
  teamId: string | null;
  createdAt: string;
}

export interface Invite {
  id: string;
  email: string | null;
  role: OrgRole;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

/* --------------------------------------------------------------------------
   Join requests

   Two ways into a studio, chosen by the admin:
     • a targeted email invite — joins immediately when they accept;
     • a common join link — anyone with it can *ask* to join, and an admin
       approves or declines from an inbox in the dashboard.
   Nothing is inserted into `memberships` until approval.
   -------------------------------------------------------------------------- */
export type JoinRequestStatus = "pending" | "approved" | "declined";

/**
 * A reusable week: weekday (0=Sun … 6=Sat) -> hour -> state. Applied at read
 * time to any day that has no row of its own, so future weeks fill themselves
 * in; an explicit day always wins.
 */
export type WeeklyDefault = Record<number, Record<number, SlotState>>;

export interface JoinLink {
  orgId: string;
  token: string;
  enabled: boolean;
  createdAt: string;
}

export interface JoinRequest {
  id: string;
  orgId: string;
  userId: string;
  /** Who asked — resolved for the inbox, so the admin knows who they're letting in. */
  profile: Profile;
  note: string | null;
  status: JoinRequestStatus;
  createdAt: string;
  decidedAt: string | null;
}

/* --------------------------------------------------------------------------
   Availability
   --------------------------------------------------------------------------
   Three states, as agreed with the client:

     free        the person said they're available
     busy        the person explicitly said they're not
     unassigned  nothing has been said about this hour (grey, "not filled in")

   An hour missing from the map *is* `unassigned`, so "not filled in" is the
   default rather than a third stored value. `states` stores only free/busy.

   The legacy shape (date -> array of free hours) is still what the grid was
   built on, and `hours` is still mirrored in the database. See
   lib/availability.ts for the conversion, which is the only place that should
   know about both shapes.
   -------------------------------------------------------------------------- */
export type SlotState = "free" | "busy";

/** date (YYYY-MM-DD) -> { hour: 'free' | 'busy' }. Missing hour = unassigned. */
export type AvailabilityStates = Record<string, Record<number, SlotState>>;

/** @deprecated legacy shape — date -> array of free hours. Use AvailabilityStates. */
export type AvailabilityMap = Record<string, number[]>;

/* --------------------------------------------------------------------------
   Teams
   -------------------------------------------------------------------------- */
export interface Team {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  /** Everyone on the roster (user ids), so the dashboard can filter in memory. */
  memberIds: string[];
  createdAt: string;
}

export interface Session {
  user: Profile;
  organization: Organization;
  membership: Membership;
  /** true when running on the in-memory demo store */
  demo: boolean;
}

/* -------------------------------------------------------------------------- */
/* Plans — used for seat-limit gating across the product                      */
/* -------------------------------------------------------------------------- */
export const PLANS: Record<
  PlanTier,
  { label: string; seats: number; priceMonthly: number | null; blurb: string; features: string[] }
> = {
  free: {
    label: "Free",
    seats: 5,
    priceMonthly: 0,
    blurb: "Kick the tyres with a small crew.",
    features: [
      "Up to 5 seats",
      "Unlimited client tasks",
      "Weekly workload dashboard",
      "14-day availability calendar",
    ],
  },
  pro: {
    label: "Pro",
    seats: 25,
    priceMonthly: 19,
    blurb: "For teams that ship for several clients.",
    features: [
      "Up to 25 seats",
      "Everything in Free",
      "Overall time-slot heatmap",
      "Role management + invite links",
      "Audit log",
    ],
  },
  business: {
    label: "Business",
    seats: 100,
    priceMonthly: 49,
    blurb: "Agencies and studios running many squads.",
    features: [
      "Up to 100 seats",
      "Everything in Pro",
      "Multiple admins",
      "Priority support",
      "Data export (CSV)",
    ],
  },
};

export const ROLE_TONE: Record<OrgRole, "indigo" | "amber" | "green" | "grey"> = {
  owner: "indigo",
  admin: "amber",
  member: "grey",
};

export const ADMIN_ROLES: OrgRole[] = ["owner", "admin"];

export function isAdminRole(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}
