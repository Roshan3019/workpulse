"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client — only used for the auth UI (password sign-in, sign-up,
 * Google OAuth redirect). All business data goes through Server Actions.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars are missing");
  return createBrowserClient(url, key);
}
