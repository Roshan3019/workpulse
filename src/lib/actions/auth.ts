"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { env, DEMO_COOKIE, ORG_COOKIE } from "../env";
import { createSupabaseServerClient } from "../supabase/server";
import { memoryStore } from "../data";
import { signInSchema, signUpSchema } from "../validation";
import { getOrigin } from "../origin";

export type ActionState = { error?: string; ok?: boolean; message?: string };

/* -------------------------------------------------------------------------- */
/* DEMO MODE                                                                  */
/* -------------------------------------------------------------------------- */
export async function demoSignIn(userId: string): Promise<void> {
  if (!env.demoMode) throw new Error("Demo sign-in is disabled in production");
  const user = await memoryStore.findDemoUser(userId);
  if (!user) throw new Error("Unknown demo user");
  const cookieStore = await cookies();
  cookieStore.set(DEMO_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
  });
  cookieStore.delete(ORG_COOKIE);
  // Land on the guided tour instead of dropping straight into the console —
  // first impression, and it doubles as the product walkthrough.
  if (user.role === "member") redirect("/app/my-tasks");
  redirect("/onboarding");
}

export async function demoReset(): Promise<void> {
  if (!env.demoMode) throw new Error("Not available");
  const { resetMemoryDatabase } = await import("../data");
  resetMemoryDatabase();
  revalidatePath("/", "layout");
}

/* -------------------------------------------------------------------------- */
/* LIVE MODE — email + password                                               */
/* -------------------------------------------------------------------------- */
/** Only same-site relative paths — prevents open redirects via ?next=. */
function safeNext(value: FormDataEntryValue | null): string {
  const raw = typeof value === "string" ? value : "";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/app";
}

export async function signInWithPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details" };
  }
  if (env.demoMode) return { error: "Password sign-in needs a configured Supabase project." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  // Honour ?next= carried by the sign-in form (set by the proxy when a
  // signed-out visitor hit a protected page).
  redirect(safeNext(formData.get("next")));
}

export async function signUpWithPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details" };
  }
  if (env.demoMode) return { error: "Sign-up needs a configured Supabase project." };

  // Invited visitors arrive from /invite/<token>; they must land back there
  // (not on /onboarding) once their account exists.
  const next = safeNext(formData.get("next"));
  const origin = await siteOrigin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: error.message };

  // If email confirmation is disabled in Supabase, a session comes back and we
  // can continue straight to the invite (or onboarding).
  if (data.session) {
    revalidatePath("/", "layout");
    redirect(next === "/app" ? "/onboarding" : next);
  }
  return { ok: true, message: "Check your inbox to confirm your email, then sign in." };
}

export async function signOut(): Promise<void> {
  if (env.demoMode) {
    const cookieStore = await cookies();
    cookieStore.delete(DEMO_COOKIE);
    cookieStore.delete(ORG_COOKIE);
    redirect("/login");
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ORG_COOKIE);
  revalidatePath("/", "layout");
  redirect("/login");
}

/** Absolute origin of the current request (for OAuth + email redirects). */
async function siteOrigin(): Promise<string> {
  return getOrigin(await headers(), env.siteUrl);
}
