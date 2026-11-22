"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { env, DEMO_COOKIE, ORG_COOKIE } from "../env";
import { createSupabaseServerClient } from "../supabase/server";
import { memoryStore } from "../data";
import { signInSchema, signUpSchema } from "../validation";

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
  redirect(user.role === "member" ? "/app/my-tasks" : "/app");
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
  redirect("/app");
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

  const origin = await siteOrigin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${origin}/auth/callback?next=/app`,
    },
  });
  if (error) return { error: error.message };

  // If email confirmation is disabled in Supabase, a session comes back and we
  // can continue straight to onboarding.
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/onboarding");
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
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : env.siteUrl;
}

export async function getOAuthUrl(next = "/app"): Promise<{ url?: string; error?: string }> {
  if (env.demoMode) return { error: "Google sign-in needs a configured Supabase project." };
  const origin = await siteOrigin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
  if (error) return { error: error.message };
  return { url: data.url };
}
