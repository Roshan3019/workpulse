import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/** Only same-site relative paths — prevents open redirects via ?next=. */
function safeNext(value: string | null, fallback = "/app"): string {
  if (!value) return fallback;
  return value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

/**
 * Refreshes the Supabase auth cookie on every request and gates /app behind
 * a signed-in user. Runs on the Edge runtime.
 */
export default async function proxy(request: NextRequest) {
  if (env.demoMode) return NextResponse.next();

  const { pathname, searchParams } = request.nextUrl;

  /*
   * Safety net for a misconfigured "Site URL" in Supabase.
   *
   * If the Site URL is not this app (e.g. http://localhost:3000) at the time
   * Supabase builds its redirect, the provider sends the user back to "/" with
   * ?code=… instead of /auth/callback, the code is never exchanged, and the
   * user appears to be "signed out" right after a successful Google login.
   * Forward the parameters to the real callback handler.
   */
  const hasAuthCode = searchParams.has("code") || searchParams.has("token_hash");
  const isCallbackPath = pathname === "/auth/callback" || pathname === "/auth/login";
  if (hasAuthCode && !isCallbackPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    url.searchParams.set("next", safeNext(searchParams.get("next")));
    return NextResponse.redirect(url);
  }

  /*
   * Only the routes that actually read the session pay for resolving it.
   *
   * `auth.getUser()` is a network call to Supabase. Running it on the marketing
   * page, the login form or a static asset's 404 adds ~50–150ms to a first
   * visit and to every image request — for a result nobody reads.
   */
  const needsSession =
    pathname.startsWith("/app") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/join") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname === "/";
  if (!needsSession) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }: { name: string; value: string }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options?: CookieOptions }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = pathname.startsWith("/app") || pathname.startsWith("/onboarding");

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Keep the full path (and any query) so we can return the user there.
    url.search = "";
    url.searchParams.set("next", pathname + (request.nextUrl.search || ""));
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
