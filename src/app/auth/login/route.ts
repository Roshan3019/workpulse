import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getOrigin } from "@/lib/origin";

/**
 * Starts the OAuth flow.
 *
 * This is a Route Handler on purpose, not a Server Action: PKCE needs a
 * `…-code-verifier` cookie written *before* the browser leaves for the
 * provider. In a handler that cookie rides on the same redirect response
 * (302 + Set-Cookie), so it can never race the navigation — which is what
 * made Google sign-in bounce back to /login with
 * "PKCE code verifier not found in storage".
 *
 * The provider is configurable so email links (confirm / recovery / magic
 * link) can reuse the same exchange logic in the callback.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getOrigin(request.headers, env.siteUrl);
  const rawNext = searchParams.get("next") ?? "/app";

  // Only same-site relative paths — never reflect an absolute URL back out.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/app";

  if (env.demoMode || !env.hasSupabase) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(
      "Google sign-in needs a configured Supabase project.",
    )}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      // Let the browser pick its own account instead of silently reusing the
      // last one — avoids "wrong account" and stale-consent dead ends.
      queryParams: { access_type: "offline", prompt: "select_account" },
    },
  });

  if (error || !data?.url) {
    const message = error?.message ?? "Could not start Google sign-in. Try again.";
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);
  }

  // `signInWithOAuth` wrote the PKCE verifier through the cookie adapter above;
  // Next attaches those Set-Cookie headers to this response.
  return NextResponse.redirect(data.url);
}
