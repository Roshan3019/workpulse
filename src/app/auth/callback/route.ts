import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getOrigin } from "@/lib/origin";

/**
 * OAuth / email-confirmation callback.
 * Supabase sends the user here with a `code` that we exchange for a session
 * cookie, then we forward them into the app.
 *
 * Works for all three Supabase redirect styles:
 *   ?code=…            OAuth + email confirmation (PKCE)
 *   ?token_hash=…&type=…  email confirmation / recovery / magic link
 *   ?error=…           provider refused (user cancelled, blocked app, …)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Absolute origin only for the cookie-bearing redirect target; relative
  // redirects below keep the browser on whatever origin it actually used.
  const origin = getOrigin(request.headers, env.siteUrl);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const errorCode = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  const rawNext = searchParams.get("next") ?? "/app";
  // Safe redirect: only allow same-site relative paths.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/app";

  if (errorCode || errorDescription) {
    const message =
      errorDescription ?? (errorCode === "access_denied" ? "Sign-in was cancelled." : errorCode ?? "Sign-in failed.");
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);
  }

  if (env.demoMode || !env.hasSupabase) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Email confirmation / recovery / magic-link flavour of the callback.
  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "signup" | "email" | "recovery" | "invite" | "magiclink" | "email_change",
    });
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
    }
    return NextResponse.redirect(`${origin}${type === "recovery" ? "/login?mode=reset" : next}`);
  }

  // Nothing to exchange — e.g. the user opened the callback directly.
  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // The usual cause is a missing/expired PKCE verifier cookie (started in a
    // different browser, or a stale tab). Send the user back with a message
    // instead of dropping them on a blank login screen.
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
