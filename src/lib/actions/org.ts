"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env, ORG_COOKIE } from "../env";
import { getStore, memoryStore } from "../data";
import { getAuthContext, requireAdmin } from "../session";
import { createSupabaseServerClient } from "../supabase/server";
import { inviteSchema, orgSchema, planSchema } from "../validation";
import { PLANS, type PlanTier } from "../types";

export type ActionResult = { error?: string; ok?: boolean; message?: string; token?: string };

/* -------------------------------------------------------------------------- */
/* Onboarding — create the first organization for a fresh account             */
/* -------------------------------------------------------------------------- */
export async function createOrganizationAction(formData: FormData): Promise<ActionResult> {
  const parsed = orgSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter a team name" };

  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  if (env.demoMode) {
    const store = memoryStore;
    const org = await store.getOrg((await import("../data/types")).DEMO_ORG_ID);
    if (org) {
      await store.updateOrg(org.id, { name: parsed.data.name });
      const membership = await store.getMembership(org.id, ctx.user.id);
      if (membership && membership.role !== "owner") {
        await store.updateMemberRole(org.id, membership.id, "owner");
      }
    }
    revalidatePath("/", "layout");
    redirect("/app");
  }

  if (ctx.membership) redirect("/app");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("create_organization", { org_name: parsed.data.name });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/app");
}

export async function renameOrgAction(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  if (session.membership.role === "member") return { error: "Not allowed" };
  const parsed = orgSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name" };

  try {
    await getStore().updateOrg(session.organization.id, { name: parsed.data.name });
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app/settings");
  revalidatePath("/app", "layout");
  return { ok: true, message: "Team name updated." };
}

/* -------------------------------------------------------------------------- */
/* Plan / seats (Stripe plugs in here later)                                  */
/* -------------------------------------------------------------------------- */
export async function setPlanAction(plan: string): Promise<ActionResult> {
  const session = await requireAdmin();
  if (session.membership.role !== "owner") return { error: "Only the owner can change the plan." };
  const parsed = planSchema.safeParse(plan);
  if (!parsed.success) return { error: "Unknown plan" };

  const target = parsed.data as PlanTier;

  if (!env.demoMode) {
    // No payment provider wired yet — record the intent instead of silently
    // granting a paid plan.
    console.info(`[workpulse] upgrade requested org=${session.organization.id} plan=${target}`);
    return {
      message: `Upgrade request for the ${PLANS[target].label} plan received. Billing isn't enabled in this build — connect Stripe to make upgrades self-serve.`,
    };
  }

  try {
    await getStore().updateOrg(session.organization.id, { plan: target, seatLimit: PLANS[target].seats });
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app/settings");
  revalidatePath("/app", "layout");
  return { ok: true, message: `Plan switched to ${PLANS[target].label} (${PLANS[target].seats} seats).` };
}

/* -------------------------------------------------------------------------- */
/* Invites                                                                    */
/* -------------------------------------------------------------------------- */
export async function createInviteAction(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = inviteSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? "member"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the invite details" };

  try {
    const invite = await getStore().createInvite(
      session.organization.id,
      parsed.data.email ?? "",
      parsed.data.role,
    );
    revalidatePath("/app/settings");
    const emailed = Boolean(parsed.data.email);
    return {
      ok: true,
      token: invite.token,
      // With email delivery configured (0003) Supabase sends the invite; the
      // link is always shown as the reliable fallback.
      message: emailed
        ? `Invite created${emailed ? " and emailed (if delivery is configured)" : ""} — the link below always works too.`
        : "Shareable link created — anyone with the link can join.",
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function revokeInviteAction(inviteId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  try {
    await getStore().revokeInvite(session.organization.id, inviteId);
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app/settings");
  return { ok: true };
}

export async function acceptInviteAction(token: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) redirect(`/login?next=/invite/${encodeURIComponent(token)}`);

  if (env.demoMode) {
    await memoryStore.acceptDemoInvite(token).catch(() => null);
    revalidatePath("/", "layout");
    redirect("/app");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("accept_invite", { invite_token: token });
  if (error) return { error: error.message };

  if (data) {
    const cookieStore = await cookies();
    cookieStore.set(ORG_COOKIE, String(data), { path: "/", sameSite: "lax" });
  }
  revalidatePath("/", "layout");
  redirect("/app");
}

/* -------------------------------------------------------------------------- */
/* Ownership transfer                                                         */
/* -------------------------------------------------------------------------- */
export async function transferOwnershipAction(userId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  if (session.membership.role !== "owner") return { error: "Only the owner can transfer ownership." };
  if (userId === session.user.id) return { error: "You are already the owner." };
  if (env.demoMode) {
    return { error: "Ownership transfer runs through a DB function — available once Supabase is connected." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("transfer_ownership", {
    target_org: session.organization.id,
    new_owner: userId,
  });
  if (error) return { error: error.message };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Ownership transferred." };
}

export async function switchOrgAction(orgId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ORG_COOKIE, orgId, { path: "/", sameSite: "lax" });
  revalidatePath("/", "layout");
  redirect("/app");
}
