import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * OAuth / email-confirmation callback.
 * Supabase sends the user here with a `code` that we exchange for a session
 * cookie, then we forward them into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";
  const errorDescription = searchParams.get("error_description");

  if (errorDescription) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorDescription)}`);
  }

  if (env.demoMode || !code) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Safe redirect: only allow same-site relative paths.
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  return NextResponse.redirect(`${origin}${target}`);
}
