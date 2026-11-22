import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "../env";

/**
 * Cookie-bound Supabase client for Server Components, Server Actions and
 * Route Handlers. All queries run as the signed-in user, so RLS applies.
 */
export async function createSupabaseServerClient() {
  if (!env.hasSupabase) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or use demo mode.",
    );
  }
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options?: CookieOptions }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component render — middleware refreshes the
          // session cookie instead, so this is safe to ignore.
        }
      },
    },
  });
}
