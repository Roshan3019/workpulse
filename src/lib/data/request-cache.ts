import "server-only";
import { cache } from "react";
import { env } from "../env";
import { getStore } from "./index";
import type { Member } from "../types";

/**
 * Request-scoped memoisation.
 *
 * Next renders a page as a tree: the layout and the page are separate
 * components, and both ask for "the signed-in session". Without memoisation
 * every one of those calls is a fresh set of Supabase round trips — twice the
 * auth lookup, twice the members query, twice the org lookup.
 *
 * `cache()` keeps one result for the lifetime of a single request (and never
 * leaks between users or requests), so the layout and the page share one
 * lookup instead of two.
 *
 * Rules for anything added here:
 *   • read-only, and keyed only by arguments that are already user-scoped;
 *   • never wrap a mutation — the dashboard must not see a stale list after a
 *     server action, and `cache()` results are discarded between requests
 *     anyway, but keeping mutations out avoids surprises.
 */

/** The signed-in user's id as verified by Supabase (one network call per request). */
export const currentUserId = cache(async (): Promise<string | null> => {
  if (env.demoMode) return null; // demo mode resolves its own user from a cookie
  const { createSupabaseServerClient } = await import("../supabase/server");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
});

/** Everyone in the organisation — the app shell needs the count on every page. */
export const orgMembers = cache(async (orgId: string): Promise<Member[]> => {
  return getStore().listMembers(orgId);
});
