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
  deadline: string | null; // YYYY-MM-DD
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

/** date (YYYY-MM-DD) -> array of free hours (0-23) */
export type AvailabilityMap = Record<string, number[]>;

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
