"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStore } from "../data";
import { getAuthContext, requireAdmin, requireSession } from "../session";
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

/**
 * Ask to join. Signed in is the only requirement.
 *
 * This used to call `requireSession`, which demands a session *with a studio*
 * and redirects to /onboarding otherwise — so a brand-new account that came
 * from a join link was asked to create a studio before it could ask to join
 * the one it was looking at. Asking is the opposite of starting a studio:
 * nothing here may depend on already having one.
 */
export async function requestToJoinAction(token: string, note?: string): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(`/join/${token}`)}`);

  let alreadyPending = false;
  try {
    const result = await getStore().requestToJoin(token, ctx.user.id, note ?? null);
    alreadyPending = result.alreadyPending;
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath(`/join/${token}`);
  // Onboarding decides between "create a studio" and "you're waiting on X",
  // and both the dashboard and settings show the pending count.
  revalidatePath("/onboarding");
  revalidatePath("/app", "layout");

  return {
    ok: true,
    message: alreadyPending
      ? "You already have a request waiting — the studio will get to it."
      : "Request sent. An admin will approve it shortly.",
  };
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
  revalidatePath("/app", "layout");
  revalidatePath("/app/team");
  revalidatePath("/onboarding");
  return { ok: true, message: `${name} is in. They can sign in and start now.` };
}

export async function declineJoinRequestAction(requestId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  try {
    await getStore().declineJoinRequest(session.organization.id, requestId);
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app", "layout");
  revalidatePath("/onboarding");
  return { ok: true, message: "Request declined." };
}
