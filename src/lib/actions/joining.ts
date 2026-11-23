"use server";

import { revalidatePath } from "next/cache";
import { getStore } from "../data";
import { requireAdmin, requireSession } from "../session";
import type { WeeklyDefault } from "../types";

export type ActionResult = { error?: string; ok?: boolean; message?: string };

/* -------------------------------------------------------------------------- */
/* Weekly default                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Save the reusable week. This never writes dates — future days inherit it at
 * read time, and any day the person has edited keeps its own copy.
 */
export async function saveWeeklyDefaultAction(week: WeeklyDefault | null): Promise<ActionResult> {
  const session = await requireSession();
  if (session.membership.role !== "member") {
    return { error: "Availability is only tracked for members." };
  }

  try {
    await getStore().setWeeklyDefault(
      session.organization.id,
      session.membership.userId,
      week,
    );
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath("/app/availability");
  revalidatePath("/app/my-tasks");
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Join link                                                                  */
/* -------------------------------------------------------------------------- */

export async function setJoinLinkEnabledAction(enabled: boolean): Promise<ActionResult> {
  const session = await requireAdmin();
  try {
    await getStore().setJoinLinkEnabled(session.organization.id, enabled);
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app/settings");
  return { ok: true, message: enabled ? "The join link is live again." : "The join link is paused." };
}

export async function rotateJoinLinkAction(): Promise<ActionResult> {
  const session = await requireAdmin();
  try {
    await getStore().rotateJoinLink(session.organization.id);
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app/settings");
  return { ok: true, message: "New link created. The old one no longer works." };
}

/* -------------------------------------------------------------------------- */
/* Join requests (the requester's side)                                       */
/* -------------------------------------------------------------------------- */

export async function requestToJoinAction(token: string, note?: string): Promise<ActionResult> {
  const session = await requireSession();
  try {
    const result = await getStore().requestToJoin(token, session.user.id, note ?? null);
    if (result.alreadyPending) {
      return { ok: true, message: "You already have a request waiting — the studio will get to it." };
    }
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath(`/join/${token}`);
  return { ok: true, message: "Request sent. An admin will approve it shortly." };
}

/* -------------------------------------------------------------------------- */
/* Join requests (the admin's side)                                           */
/* -------------------------------------------------------------------------- */

export async function approveJoinRequestAction(requestId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  let name = "They";
  try {
    const store = getStore();
    const pending = await store.listJoinRequests(session.organization.id);
    const target = pending.find((r) => r.id === requestId);
    if (target) name = target.profile.fullName ?? target.profile.email ?? name;
    await store.approveJoinRequest(session.organization.id, requestId);
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app");
  revalidatePath("/app/team");
  return { ok: true, message: `${name} is in. They can sign in and start now.` };
}

export async function declineJoinRequestAction(requestId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  try {
    await getStore().declineJoinRequest(session.organization.id, requestId);
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app");
  return { ok: true, message: "Request declined." };
}
