/**
 * Canonical public origin of the app, used for OAuth and email redirects.
 *
 * Precedence, in this order:
 *   1. the host the browser actually used — `x-forwarded-host` on Vercel,
 *      falling back to `Host`
 *   2. `NEXT_PUBLIC_SITE_URL`, only when there is no request host at all
 *
 * (2) used to win, and that is exactly what broke Google sign-in on any URL
 * that was not the configured one: the OAuth `redirectTo` pointed at
 * `NEXT_PUBLIC_SITE_URL` while the browser was on a preview/project domain, so
 * Supabase's allow-list and the PKCE verifier cookie disagreed and the user
 * was dropped back on a sign-in page. The origin the user is *on* is the only
 * one whose cookies will still exist when the provider sends them back, so it
 * wins. Supabase's redirect allow-list is wildcarded for this project's
 * `workpulse-*-roshan-s-team2.vercel.app` / `workpulse-*.vercel.app` hosts.
 *
 * This is not an open redirect: the result is only used to send the browser
 * back to the host it is already on (and Vercel only routes its own hosts
 * here). Paths are always relative and validated by the callers.
 */
export function getOrigin(headers: Headers, fallback: string): string {
  const forwardedHost = headers.get("x-forwarded-host");
  const host = forwardedHost ?? headers.get("host");
  const proto =
    headers.get("x-forwarded-proto") ??
    (host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");

  if (host) return `${proto}://${host}`;

  const configured = fallback?.replace(/\/$/, "");
  return configured || "http://localhost:3000";
}
