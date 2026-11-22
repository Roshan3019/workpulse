"use server";

import { revalidatePath } from "next/cache";
import { getStore } from "../data";
import { requireAdmin } from "../session";
import { capacitySchema, roleSchema } from "../validation";
import type { OrgRole } from "../types";

export type ActionResult = { error?: string; ok?: boolean };

function refresh() {
  revalidatePath("/app/team");
  revalidatePath("/app");
  revalidatePath("/app/availability");
  revalidatePath("/app/tasks");
}

/**
 * Change a teammate's role.
 *
 * Rules (mirrored by DB triggers so the API can't be bypassed):
 *  - nobody can change their own role
 *  - an admin cannot change the owner's role
 *  - an org always keeps at least one owner
 *  - only owner/admin may call this at all
 */
export async function changeRoleAction(membershipId: string, role: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) return { error: "Unknown role" };

  const store = getStore();
  const orgId = session.organization.id;
  const members = await store.listMembers(orgId);
  const target = members.find((m) => m.id === membershipId);
  if (!target) return { error: "Member not found" };

  if (target.userId === session.user.id) {
    return { error: "You can't change your own role. Ask another owner or admin." };
  }
  if (target.role === "owner" && session.membership.role !== "owner") {
    return { error: "Only the owner can change the owner's role." };
  }
  if (parsedRole.data === "owner") {
    return { error: "Ownership is transferred from Settings, not the team grid." };
  }
  if (target.role === "owner") {
    return { error: "Transfer ownership first, then change this role." };
  }
  if (parsedRole.data === target.role) return { ok: true };

  try {
    await store.updateMemberRole(orgId, membershipId, parsedRole.data as OrgRole);
  } catch (error) {
    return { error: (error as Error).message };
  }
  refresh();
  return { ok: true };
}

export async function changeCapacityAction(membershipId: string, capacity: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = capacitySchema.safeParse(capacity);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid capacity" };

  try {
    await getStore().updateMemberCapacity(session.organization.id, membershipId, parsed.data);
  } catch (error) {
    return { error: (error as Error).message };
  }
  refresh();
  return { ok: true };
}

export async function removeMemberAction(membershipId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const store = getStore();
  const members = await store.listMembers(session.organization.id);
  const target = members.find((m) => m.id === membershipId);
  if (!target) return { error: "Member not found" };
  if (target.userId === session.user.id) return { error: "You can't remove yourself." };
  if (target.role === "owner") return { error: "The owner can't be removed. Transfer ownership first." };

  try {
    await store.removeMember(session.organization.id, membershipId);
  } catch (error) {
    return { error: (error as Error).message };
  }
  refresh();
  return { ok: true };
}
