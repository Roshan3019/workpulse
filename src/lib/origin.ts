/**
 * Canonical public origin of the app, used for OAuth and email redirects.
 *
 * This deliberately does **not** trust the `Host` header alone: in dev the
 * server binds 0.0.0.0 and a request can arrive as `localhost` or `127.0.0.1`,
 * which produces redirect URLs that don't match the Supabase allow-list.
 * Precedence:
 *   1. `NEXT_PUBLIC_SITE_URL` — the canonical public URL (set this in prod)
 *   2. forwarded host/proto — what the browser actually used (Vercel, tunnels)
 *   3. the request's own host
 */
export function getOrigin(headers: Headers, fallback: string): string {
  const forwardedHost = headers.get("x-forwarded-host");
  const host = forwardedHost ?? headers.get("host");
  const proto =
    headers.get("x-forwarded-proto") ?? (host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");

  const requestOrigin = host ? `${proto}://${host}` : null;

  // A configured site URL wins, but in local development it is often a
  // placeholder — so only prefer it when it agrees with the host we were
  // actually reached on, or when we're not on a loopback address.
  const configured = fallback?.replace(/\/$/, "");
  if (configured) {
    try {
      const cfg = new URL(configured);
      const cfgIsLoopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(cfg.hostname);
      if (!requestOrigin) return configured;
      const reqIsLoopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(requestOrigin.replace(/^https?:\/\//, "").replace(/:\d+$/, ""));
      // Trust the configured value in production; in local dev prefer the host
      // the browser is on so cookies and redirect URLs stay on one origin.
      if (!cfgIsLoopback || reqIsLoopback) return configured;
      return requestOrigin;
    } catch {
      return requestOrigin ?? configured;
    }
  }

  return requestOrigin ?? "http://localhost:3000";
}
