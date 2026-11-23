/**
 * Auth round-trip test — verifies the OAuth callback establishes a session on the
 * FIRST pass, so Google sign-in never bounces back to /login.
 *
 * No Supabase project needed: a mock GoTrue server stands in for Supabase Auth,
 * and a cookie jar mimics the browser's redirect chain. This exercises the real
 * Next.js server, the real @supabase/ssr cookie code, and the PKCE verifier.
 *
 *   npm run test:auth
 */
const http = require("http");
const { spawn } = require("child_process");
const { rmSync } = require("fs");

const MOCK_PORT = 54321;
const APP_PORT = 8099;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const VERIFIER = "test-code-verifier-abc123";
const AUTH_CODE = "good-code-123";
const ACCESS_TOKEN = "access-token-123";
const USER_ID = "99999999-9999-9999-9999-999999999999";

// supabase-js derives the storage key from the first hostname label.
const PROJECT_REF = new URL(`http://127.0.0.1:${MOCK_PORT}`).hostname.split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const VERIFIER_COOKIE = `${STORAGE_KEY}-code-verifier`;

const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const SESSION = {
  access_token: ACCESS_TOKEN,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "refresh-token-123",
  user: {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "roshan@workpulse.test",
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { full_name: "Roshan Patel", avatar_url: null },
    created_at: new Date().toISOString(),
  },
};

function startMock() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
      const send = (status, obj, headers = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(obj === null ? "null" : JSON.stringify(obj));
      };
      seen.push(`${req.method} ${url.pathname}${url.search}`);

      // PKCE token exchange used by exchangeCodeForSession()
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
        // auth-js sends these JSON-encoded in the body; accept form-encoded too.
        let params = new URLSearchParams(body);
        try {
          const parsed = JSON.parse(body);
          params = new URLSearchParams(parsed);
        } catch {}
        const verifier = params.get("code_verifier");
        const code = params.get("auth_code");
        if (code !== AUTH_CODE) {
          return send(400, { error: "invalid_grant", error_description: "invalid auth code", msg: "invalid auth code" });
        }
        if (verifier !== VERIFIER) {
          return send(400, {
            error: "invalid_grant",
            error_description: "code verifier does not match",
            msg: "code verifier does not match",
          });
        }
        return send(200, SESSION);
      }
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
        return send(200, SESSION);
      }
      // getUser() / getSession() validation
      if (url.pathname === "/auth/v1/user") {
        const auth = req.headers.authorization || "";
        if (auth === `Bearer ${ACCESS_TOKEN}`) return send(200, SESSION.user);
        return send(401, { error: "invalid_token", error_description: "Invalid JWT", msg: "Invalid JWT" });
      }
      /*
       * A pending join request. The onboarding page asks "is anyone deciding
       * on me?" before it offers "create a studio", and that must not be the
       * reason a test fails for the wrong reason: answer with an empty list so
       * this suite still exercises the no-studio branch.
       */
      if (url.pathname === "/rest/v1/rpc/my_join_requests") {
        return send(200, []);
      }
      // PostgREST: no profile row, no memberships -> user has a session but no org
      if (url.pathname.startsWith("/rest/v1/")) {
        const wantsObject = String(req.headers.accept || "").includes("object+json");
        return send(200, wantsObject ? null : []);
      }
      if (url.pathname.startsWith("/auth/v1/")) return send(200, {});
      send(404, { error: "not found" });
    });
  });
  return new Promise((resolve) => {
    server.listen(MOCK_PORT, "127.0.0.1", () => resolve({ server, seen }));
  });
}

/* ----------------------------- tiny cookie jar ---------------------------- */
function makeJar() {
  const jar = new Map();
  return {
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb: (res) => {
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const idx = pair.indexOf("=");
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        const expires = /expires=([^;]+)/i.exec(raw);
        const maxAge = /max-age=(-?\d+)/i.exec(raw);
        const dead =
          value === "" ||
          (maxAge && Number(maxAge[1]) <= 0) ||
          (expires && new Date(expires[1]).getTime() < Date.now());
        if (dead) jar.delete(name);
        else jar.set(name, value);
      }
    },
    get: (n) => jar.get(n),
    set: (n, v) => jar.set(n, v),
    dump: () => Object.fromEntries(jar),
  };
}

function req(jar, path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  return fetch(BASE + path, { ...opts, headers, redirect: "manual" });
}

/** Fail fast if something else already owns the port — otherwise every check
 *  silently runs against a stale server from a previous run. */
function requireFreePorts() {
  const net = require("net");
  return Promise.all([APP_PORT, MOCK_PORT].map((port) => new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", (e) =>
      reject(new Error(`port ${port} is already in use (${e.code}) — stop the stale process first`)));
    srv.once("listening", () => srv.close(() => resolve()));
    srv.listen(port, "127.0.0.1");
  })));
}

function waitForReady(proc, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let out = "";
    proc.once("exit", (code) => reject(new Error(`next start exited (${code})\n` + out)));
    const tick = async () => {
      try {
        const r = await fetch(BASE + "/login", { redirect: "manual" });
        if (r.status < 500) return resolve();
      } catch {}
      if (Date.now() - started > timeoutMs) return reject(new Error("server did not start\n" + out));
      setTimeout(tick, 400);
    };
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    tick();
  });
}

(async () => {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
    ok ? pass++ : fail++;
  };

  await requireFreePorts();
  const mock = await startMock();
  console.log("mock Supabase auth listening on", MOCK_PORT);

  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key",
    NEXT_PUBLIC_DEMO_MODE: "0",
    NEXT_PUBLIC_SITE_URL: BASE,
    NEXT_TELEMETRY_DISABLED: "1",
  };

  let proc;
  try {
    console.log("building (NEXT_PUBLIC_* are inlined at build time)…");
    // A stale .next can serve the previous route table (routes appear/disappear),
    // so every run starts from a clean build.
    rmSync(".next", { recursive: true, force: true });
    await new Promise((resolve, reject) => {
      const b = spawn("npx", ["next", "build"], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
      let log = "";
      b.stdout.on("data", (d) => (log += d));
      b.stderr.on("data", (d) => (log += d));
      b.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("build failed\n" + log.slice(-3000)))));
    });

    proc = spawn("npx", ["next", "start", "-p", String(APP_PORT)], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForReady(proc);
    console.log("app started on", APP_PORT);

    /* ---------- 1. signed-out guard ---------- */
    const jar = makeJar();
    let r = await req(jar, "/app");
    check(
      "signed out: /app redirects to /login",
      r.status === 307 && (r.headers.get("location") || "").includes("/login"),
      `${r.status} ${r.headers.get("location")}`,
    );

    /* ---------- 1b. starting OAuth sets the PKCE verifier on the redirect ---------- */
    const jarStart = makeJar();
    r = await req(jarStart, "/auth/login?next=%2Fapp");
    const startLoc = r.headers.get("location") || "";
    const startCookies = r.headers.getSetCookie?.() ?? [];
    check(
      "OAuth start redirects to the provider authorize URL",
      r.status === 307 && startLoc.includes("/auth/v1/authorize") && startLoc.includes("provider=google"),
      `${r.status} ${startLoc.slice(0, 78)}…`,
    );
    check(
      "OAuth start sets the code-verifier cookie on the SAME response",
      startCookies.some((c) => c.startsWith(VERIFIER_COOKIE + "=")),
      startCookies.map((c) => c.split("=")[0]).join(", ") || "none",
    );
    check(
      "authorize URL carries the PKCE challenge",
      /[?&]code_challenge=/.test(startLoc) && /code_challenge_method=s256/.test(startLoc),
    );
    {
      const redirectTo = decodeURIComponent(startLoc).match(/redirect_to=([^&]*)/)?.[1] || "";
      check(
        "authorize URL returns to /auth/callback (not the bare Site URL)",
        redirectTo.startsWith(BASE + "/auth/callback"),
        redirectTo || "missing redirect_to",
      );
      // The redirect must come back to the SAME origin the browser is on, or
      // the session cookie lands on a different host and the user looks signed out.
      check(
        "redirect_to origin matches the origin the browser is using",
        redirectTo.startsWith(BASE),
        `${redirectTo.split("/auth/callback")[0]} vs ${BASE}`,
      );
    }

    /* ---------- 2. the bounce: callback -> /app must keep the session ---------- */
    jar.set(VERIFIER_COOKIE, "base64-" + b64url(JSON.stringify(VERIFIER)));
    r = await req(jar, `/auth/callback?code=${AUTH_CODE}&next=%2Fapp`);
    jar.absorb(r);
    const loc = r.headers.get("location") || "";
    const setCookies = r.headers.getSetCookie?.() ?? [];
    check("callback redirects to /app (not /login)", loc.endsWith("/app"), `${r.status} ${loc}`);
    check(
      "callback returns a Set-Cookie for the session",
      setCookies.some((c) => c.startsWith(STORAGE_KEY + "=")),
      setCookies.map((c) => c.split("=")[0]).join(", ") || "none",
    );
    check(
      "session cookie is in the jar after the redirect",
      String(jar.get(STORAGE_KEY) || "").length > 0,
      String(jar.get(STORAGE_KEY) || "").slice(0, 24) + "…",
    );

    r = await req(jar, "/app");
    const after = r.headers.get("location") || "";
    check(
      "first pass after callback: /app does NOT bounce to /login",
      !after.includes("/login"),
      `${r.status} ${after || "(rendered)"}`,
    );
    // No membership in the mock DB, so a valid session lands on /onboarding.
    check("session works end to end (/app -> /onboarding)", r.status === 307 && after.endsWith("/onboarding"), `${r.status} ${after}`);
    r = await req(jar, "/onboarding");
    check("/onboarding renders for the signed-in user", r.status === 200, String(r.status));

    /* ---------- 3. bad code must fail loudly, not silently ---------- */
    const jar2 = makeJar();
    jar2.set(VERIFIER_COOKIE, "base64-" + b64url(JSON.stringify(VERIFIER)));
    r = await req(jar2, "/auth/callback?code=BAD-CODE&next=%2Flogin");
    const badLoc = r.headers.get("location") || "";
    check("invalid code redirects to /login?error=", badLoc.includes("/login?error="), badLoc);

    /*
     * A failed exchange on the way to a join link must go back to the join link
     * with the error, not to a bare sign-in page — that dead end is what made a
     * shared join link look broken.
     */
    const jar2b = makeJar();
    jar2b.set(VERIFIER_COOKIE, "base64-" + b64url(JSON.stringify(VERIFIER)));
    r = await req(jar2b, "/auth/callback?code=BAD-CODE&next=%2Fjoin%2Fdemo-join-link-token");
    const joinLoc = r.headers.get("location") || "";
    check(
      "invalid code on a join link returns to the join page with the error",
      joinLoc.includes("/join/demo-join-link-token?error="),
      joinLoc,
    );

    /* ---------- 4. stray ?code= landing on / must be forwarded, not dropped ---------- */
    const jar3 = makeJar();
    r = await req(jar3, `/?code=${AUTH_CODE}`);
    const strayLoc = r.headers.get("location") || "";
    check(
      "stray ?code= on / is forwarded to /auth/callback (proxy safety net)",
      r.status === 307 && strayLoc.includes("/auth/callback") && strayLoc.includes(AUTH_CODE),
      `${r.status} ${strayLoc}`,
    );

    // …and following that redirect really does establish the session.
    const jar4 = makeJar();
    jar4.set(VERIFIER_COOKIE, "base64-" + b64url(JSON.stringify(VERIFIER)));
    r = await req(jar4, `/auth/callback?code=${AUTH_CODE}&next=%2Fapp`);
    jar4.absorb(r);
    r = await req(jar4, "/app");
    check(
      "recovered code from / establishes a session",
      !(r.headers.get("location") || "").includes("/login"),
      `${r.status} ${r.headers.get("location") || "(rendered)"}`,
    );

    /* ---------- 5. signed-out /login can carry an error message ---------- */
    r = await req(makeJar(), "/login?error=Cancelled%20by%20user&next=%2Fapp");
    const html = await r.text();
    check("login page surfaces ?error= to the user", r.status === 200 && /Cancelled by user/.test(html), String(r.status));
    check("login page keeps ?next= in the form", html.includes('name="next"') && html.includes('value="/app"'));
    check("login page shows no demo/dev banner", !/Demo mode:/i.test(html));

    const htmlDemo = await (await req(makeJar(), "/login")).text();
    check("login page offers a working Google link", htmlDemo.includes('href="/auth/login?next=%2Fapp"'), "link present");
  } finally {
    proc?.kill("SIGKILL");
    mock.server.close();
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exit(1);
});
