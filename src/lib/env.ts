/**
 * Central env access with safe fallbacks.
 *
 * Demo mode lets the whole product run with **no** Supabase project — useful for
 * previews, demos, and this workspace. Production must set real values.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const explicitDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

const hasSupabase = Boolean(url && anonKey && url.startsWith("http"));

export const env = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:8080").replace(/\/$/, ""),
  /** Demo store is used when explicitly requested or when Supabase is not configured. */
  demoMode: explicitDemo || !hasSupabase,
  hasSupabase,
};

export const DEMO_COOKIE = "wp_demo_user";
/**
 * @deprecated No longer read. A session opens the studio it most recently
 * joined (see lib/session.ts); the multi-studio switcher was removed at the
 * client's request, so there is nothing to switch. The value is still cleared
 * on sign-out so an old cookie cannot linger.
 */
export const ORG_COOKIE = "wp_org";
