import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env, DEMO_COOKIE, ORG_COOKIE } from "./env";
import { getStore, memoryStore } from "./data";
import { DEMO_ORG_ID } from "./data/types";
import { createSupabaseServerClient } from "./supabase/server";
import { isAdminRole, type OrgRole, type Organization, type Profile, type Session } from "./types";

export interface AuthContext {
  user: Profile;
  membership: Session["membership"] | null;
  organization: Organization | null;
  demo: boolean;
}

/** Resolve the signed-in user + their org membership (or null when signed out). */
export async function getAuthContext(): Promise<AuthContext | null> {
  if (env.demoMode) {
    const cookieStore = await cookies();
    const userId = cookieStore.get(DEMO_COOKIE)?.value;
    if (!userId) return null;
    const demoUser = await memoryStore.findDemoUser(userId);
    if (!demoUser) return null;

    const store = getStore();
    // Demo mode serves a single seeded organization.
    const organization = await store.getOrg(DEMO_ORG_ID);
    if (!organization) return null;
    const membership = await store.getMembership(organization.id, userId);

    return {
      user: {
        id: demoUser.id,
        email: demoUser.email,
        fullName: demoUser.fullName,
        avatarUrl: demoUser.avatarUrl,
      },
      membership,
      organization,
      demo: true,
    };
  }

  /* ----------------------------- live mode ----------------------------- */
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  let profile: Profile = {
    id: user.id,
    email: user.email ?? "",
    fullName: (user.user_metadata?.full_name as string) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string) ?? null,
  };
  if (profileRow && !profileError) {
    profile = {
      id: profileRow.id,
      email: profileRow.email,
      fullName: profileRow.full_name,
      avatarUrl: profileRow.avatar_url,
    };
  }

  const store = getStore();
  const cookieStore = await cookies();
  const preferredOrg = cookieStore.get(ORG_COOKIE)?.value;

  const { data: membershipRows } = await supabase
    .from("memberships")
    .select("id, org_id, user_id, role, capacity")
    .eq("user_id", user.id);

  const rows = membershipRows ?? [];
  const chosen = rows.find((r) => r.org_id === preferredOrg) ?? rows[0];
  if (!chosen) {
    return { user: profile, membership: null, organization: null, demo: false };
  }

  const organization = await store.getOrg(chosen.org_id as string);
  return {
    user: profile,
    membership: {
      id: chosen.id,
      orgId: chosen.org_id,
      userId: chosen.user_id,
      role: chosen.role as OrgRole,
      capacity: chosen.capacity,
    },
    organization,
    demo: false,
  };
}

/** Session that is guaranteed to have an organization (else → /onboarding). */
export async function requireSession(): Promise<Session> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!ctx.membership || !ctx.organization) redirect("/onboarding");
  return {
    user: ctx.user,
    membership: ctx.membership,
    organization: ctx.organization,
    demo: ctx.demo,
  };
}

/** Session that must be owner/admin (members are sent to their own view). */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (!isAdminRole(session.membership.role)) redirect("/app/my-tasks");
  return session;
}

export async function getOrgMemberships(): Promise<{ id: string; name: string; role: OrgRole; slug: string }[]> {
  if (env.demoMode) {
    const ctx = await getAuthContext();
    if (!ctx) return [];
    const store = getStore();
    const org = await store.getOrg(DEMO_ORG_ID);
    return org ? [{ id: org.id, name: org.name, role: ctx.membership?.role ?? "member", slug: org.slug }] : [];
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, slug)")
    .eq("user_id", user.id);
  return (data ?? []).map((row: any) => ({
    id: row.organizations.id,
    name: row.organizations.name,
    slug: row.organizations.slug,
    role: row.role as OrgRole,
  }));
}
