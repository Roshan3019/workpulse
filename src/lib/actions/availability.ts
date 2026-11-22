"use server";

import { revalidatePath } from "next/cache";
import { getStore } from "../data";
import { requireSession } from "../session";
import { availabilitySchema } from "../validation";

export type ActionResult = { error?: string; ok?: boolean };

/**
 * Persist one day of free hours for the signed-in member.
 * Admins/owners cannot save availability (blocked here *and* by a DB trigger).
 */
export async function saveAvailabilityAction(date: string, hours: number[]): Promise<ActionResult> {
  const session = await requireSession();

  if (session.membership.role !== "member") {
    return { error: "Availability is only tracked for members — admins don't set availability." };
  }

  const parsed = availabilitySchema.safeParse({ date, hours });
  if (!parsed.success) return { error: "Invalid date or hours" };

  try {
    await getStore().saveAvailability(
      session.organization.id,
      session.membership.userId,
      parsed.data.date,
      parsed.data.hours,
    );
  } catch (error) {
    return { error: (error as Error).message };
  }

  revalidatePath("/app/availability");
  revalidatePath("/app");
  return { ok: true };
}

/** Save several days at once (used by the "apply to weekdays" shortcut). */
export async function bulkSaveAvailabilityAction(entries: { date: string; hours: number[] }[]): Promise<ActionResult> {
  const session = await requireSession();
  if (session.membership.role !== "member") {
    return { error: "Availability is only tracked for members." };
  }
  const store = getStore();
  try {
    for (const entry of entries) {
      const parsed = availabilitySchema.safeParse(entry);
      if (!parsed.success) continue;
      await store.saveAvailability(
        session.organization.id,
        session.membership.userId,
        parsed.data.date,
        parsed.data.hours,
      );
    }
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/app/availability");
  revalidatePath("/app");
  return { ok: true };
}
