#!/usr/bin/env node
/**
 * npm run test:perf
 *
 * Guards the things that made the deployed app feel slow. None of these are
 * visible on a laptop (localhost has no latency), which is exactly why they
 * need a test: a future refactor would quietly put them back.
 *
 * Checks:
 *   1. The app routes are pinned to the database's region.
 *   2. The session resolver is memoised per request, so the layout and the
 *      page cannot each pay the auth cost.
 *   3. Page data is fetched in parallel, not in sequence.
 *   4. Every /app route has a loading skeleton.
 *   5. The performance migration exists, is idempotent, and does not alter
 *      which rows anyone can see.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const detail = fn();
    passed++;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n         ${e.message}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

console.log("=== performance guards ===");

/* -------------------------------------------------------------------------- */
/* 1. Region                                                                  */
/* -------------------------------------------------------------------------- */
check("vercel.json pins functions to the database region", () => {
  const raw = read("vercel.json");
  const cfg = JSON.parse(raw);
  assert(
    Array.isArray(cfg.regions) && cfg.regions.length === 1,
    "vercel.json must set exactly one region (the Hobby plan allows a single function region)",
  );
  assert(
    cfg.regions[0] === "bom1",
    `regions[0] is "${cfg.regions[0]}" but the Supabase project is in ap-south-1 (Mumbai) → expected "bom1"`,
  );
  return `regions = ["${cfg.regions[0]}"]`;
});

check("region is NOT set per-route (a Hobby-plan trap)", () => {
  /*
   * `export const preferredRegion` in a page/layout looks correct and builds
   * cleanly, but the Hobby plan ignores it: the deployment still reports
   * regions: ["iad1"] and every query keeps crossing the planet. It has to be
   * project-level. This is the exact mistake that was made once already.
   */
  const layouts = ["src/app/app/layout.tsx", "src/app/app/page.tsx", "src/app/layout.tsx"];
  const offenders = layouts.filter((p) =>
    /export const preferredRegion\s*=/.test(read(p)),
  );
  assert(
    offenders.length === 0,
    `per-route preferredRegion is ignored on Hobby — set it in vercel.json instead: ${offenders.join(", ")}`,
  );
  return "vercel.json is the single source of truth";
});

/* -------------------------------------------------------------------------- */
/* 2. Session memoisation                                                     */
/* -------------------------------------------------------------------------- */
check("getAuthContext is wrapped in React cache()", () => {
  const src = read("src/lib/session.ts");
  assert(
    /export const getAuthContext\s*=\s*cache\(/.test(src),
    "getAuthContext is not memoised — the layout and the page will each query auth/user/memberships",
  );
  assert(/from "react"/.test(src), "react cache() is not imported in src/lib/session.ts");
  return "one resolution per request";
});

check("session resolves the profile and memberships in parallel", () => {
  const src = read("src/lib/session.ts");
  assert(
    /Promise\.all\(\[\s*supabase[\s\S]{0,400}memberships/.test(src),
    "profile and membership lookups are awaited in sequence — that doubles the latency",
  );
  return "Promise.all";
});

check("session reads the organisation via an embedded select", () => {
  const src = read("src/lib/session.ts");
  assert(
    /organizations\(id, name, slug/.test(src),
    "organisation is fetched with a separate getOrg() round trip instead of an embedded select",
  );
  return "no extra round trip";
});

/* -------------------------------------------------------------------------- */
/* 3. Shared member list                                                      */
/* -------------------------------------------------------------------------- */
check("layout and pages share one member query", () => {
  const layout = read("src/app/app/layout.tsx");
  assert(/orgMembers\(/.test(layout), "layout does not use the shared orgMembers() cache");
  const pages = [
    "src/app/app/page.tsx",
    "src/app/app/team/page.tsx",
    "src/app/app/tasks/page.tsx",
    "src/app/app/settings/page.tsx",
    "src/app/app/availability/page.tsx",
  ];
  const offenders = pages.filter((p) => /store\.listMembers\(orgId\)/.test(read(p)));
  assert(offenders.length === 0, `these pages re-query members directly: ${offenders.join(", ")}`);
  return `${pages.length} pages reuse the layout's result`;
});

check("request cache never wraps a mutation", () => {
  const src = read("src/lib/data/request-cache.ts");
  const bad = /cache\(\s*async[\s\S]{0,600}?(createTask|updateTask|deleteTask|createInvite|saveAvailability|updateOrg)/;
  assert(!bad.test(src), "request-cache.ts memoises a write path; mutations must never be cached");
  return "read-only";
});

/* -------------------------------------------------------------------------- */
/* 4. Loading skeletons                                                       */
/* -------------------------------------------------------------------------- */
check("every /app route ships a loading skeleton", () => {
  const routes = ["", "tasks", "team", "availability", "settings", "my-tasks"];
  const missing = routes.filter(
    (r) => !fs.existsSync(path.join(ROOT, "src/app/app", r, "loading.tsx")),
  );
  assert(missing.length === 0, `no loading.tsx for: ${missing.map((m) => "/app/" + m).join(", ")}`);
  return `${routes.length} routes`;
});

check("skeleton respects reduced-motion", () => {
  const src = read("src/components/ui/Skeleton.tsx");
  assert(/motion-reduce:animate-none/.test(src), "pulse animation ignores prefers-reduced-motion");
  return "motion-reduce";
});

/* -------------------------------------------------------------------------- */
/* 5. Migration                                                               */
/* -------------------------------------------------------------------------- */
check("performance migration exists and is idempotent", () => {
  const src = read("supabase/migrations/0004_performance.sql");
  assert(/create index if not exists/.test(src), "no CREATE INDEX IF NOT EXISTS");
  const creates = src.match(/create index (?!if not exists)/g);
  assert(!creates, "a CREATE INDEX is not guarded by IF NOT EXISTS");
  const policies = src.match(/create policy (\w+)/g) || [];
  const drops = src.match(/drop policy if exists (\w+)/g) || [];
  assert(
    policies.length === drops.length,
    `${policies.length} policies created but ${drops.length} dropped — a re-run would fail`,
  );
  return `${policies.length} policies, all re-creatable`;
});

check("migration only wraps auth.uid(), never the row-scoped helpers", () => {
  const src = read("supabase/migrations/0004_performance.sql")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  // Hoisting is_org_admin(org_id) would be wrong: it depends on the row's own
  // column, so turning it into an InitPlan would silently change the policy.
  const bad = /\(\s*select\s+public\.(is_org_admin|is_org_member|role_in_org)\s*\(/;
  assert(!bad.test(src), "a row-scoped helper is wrapped in a subquery — that changes its meaning");
  assert(
    /\(\s*select\s+auth\.uid\(\)\s*\)/.test(src),
    "auth.uid() was not wrapped in (select ...), so it still runs per row",
  );
  return "auth.uid() hoisted, helpers untouched";
});

check("indexes cover the query shapes the app actually uses", () => {
  const src = read("supabase/migrations/0004_performance.sql");
  const wanted = [
    ["tasks", "org_id, assignee_id"],
    ["availability", "org_id, user_id, slot_date"],
    ["memberships", "org_id, user_id"],
    ["invites", "token"],
  ];
  for (const [table, cols] of wanted) {
    assert(
      src.includes(`on public.${table} (${cols})`),
      `missing index on ${table} (${cols})`,
    );
  }
  return `${wanted.length} indexes`;
});

/* -------------------------------------------------------------------------- */
/* 6. Don't reintroduce the triple task query                                 */
/* -------------------------------------------------------------------------- */
check("tasks page fetches the task list once", () => {
  const src = read("src/app/app/tasks/page.tsx");
  const calls = (src.match(/store\.listTasks\(/g) || []).length;
  assert(calls <= 1, `tasks page runs store.listTasks() ${calls} times; filter one result in memory`);
  return `${calls} query`;
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
