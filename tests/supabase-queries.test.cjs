#!/usr/bin/env node
/**
 * npm run test:supabase
 *
 * Guards the query shapes `SupabaseStore` sends to PostgREST.
 *
 * Why a fake server: the deployed app broke with
 *
 *   load tasks: failed to parse logic tree
 *   ((assignee_id.eq.63a1…,task_assignees.user_id.eq.63a1…))
 *
 * because PostgREST cannot put an *embedded* table's column inside an `or()`
 * on the parent. Nothing in this repo caught it — the demo store happily
 * answered, and PGlite only tests SQL, not the REST layer. So this harness
 * speaks the PostgREST protocol well enough to reject the same thing the real
 * one rejects, and runs the real store code against it.
 *
 * It also checks the pre-0010 fallback: a project without `task_assignees`
 * must still be able to list tasks.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    const detail = fn();
    passed++;
    console.log(`  PASS  ${name}${detail ? `  → ${detail}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}  → ${e && e.message}`);
  }
}
async function checkAsync(name, fn) {
  try {
    const detail = await fn();
    passed++;
    console.log(`  PASS  ${name}${detail ? `  → ${detail}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}  → ${e && e.message}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/* -------------------------------------------------------------------------- */
/* The fake PostgREST                                                         */
/* -------------------------------------------------------------------------- */

const ORG = "99999999-9999-4999-8999-999999999999";
const ME = "63a1f94c-74b0-4baa-9280-c9d8d868863c";
const OTHER = "11111111-1111-4111-8111-111111111111";

/** Requests the store made, so the test can assert *how* it asked. */
const log = [];

/** Set by a test to simulate a project that has not run 0010. */
let hasAssigneesTable = true;

const TASKS = [
  { id: "t1", org_id: ORG, title: "Led by me", assignee_id: ME, team_id: null, status: "pending" },
  { id: "t2", org_id: ORG, title: "Shared with me", assignee_id: OTHER, team_id: null, status: "in_progress" },
  { id: "t3", org_id: ORG, title: "Nothing to do with me", assignee_id: OTHER, team_id: null, status: "pending" },
];
const ASSIGNEES = [
  { task_id: "t1", user_id: ME, org_id: ORG, position: 0 },
  { task_id: "t2", user_id: OTHER, org_id: ORG, position: 0 },
  { task_id: "t2", user_id: ME, org_id: ORG, position: 1 },
  { task_id: "t3", user_id: OTHER, org_id: ORG, position: 0 },
];

/** Split a PostgREST `or=(a.eq.1,b.eq.2)` value into its clauses. */
function parseLogicTree(raw) {
  const text = raw.replace(/^\(/, "").replace(/\)$/, "");
  const clauses = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      clauses.push(current);
      current = "";
    } else current += char;
  }
  if (current) clauses.push(current);
  return clauses;
}

function respond(status, body, headers = {}) {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ "content-type": "application/json", ...headers }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function fakeFetch(url, init = {}) {
  const target = new URL(url);
  const table = target.pathname.replace(/^\/rest\/v1\//, "");
  const method = (init.method ?? "GET").toUpperCase();
  const params = target.searchParams;
  const select = params.get("select") ?? "*";
  const where = {};
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "or"].includes(key)) continue;
    where[key] = value.replace(/^eq\./, "");
  }
  log.push({ table, method, select, where, or: params.get("or") });

  /* --- the rejection that started all this --- */
  const or = params.get("or");
  if (or && /task_assignees\./.test(or)) {
    return respond(400, {
      code: "PGRST100",
      message: `failed to parse logic tree ((${or}))" (line 1, column 71)`,
      details: "unexpected \".\" expecting \")\"",
    });
  }

  if (table === "task_assignees" && !hasAssigneesTable) {
    return respond(404, {
      code: "PGRST205",
      message: "Could not find the table 'public.task_assignees' in the schema cache",
    });
  }

  if (table === "tasks") {
    const wantsEmbed = /task_assignees\s*\(/.test(select);
    if (wantsEmbed && !hasAssigneesTable) {
      return respond(400, {
        code: "PGRST200",
        message:
          "Could not find a relationship between 'tasks' and 'task_assignees' in the schema cache",
      });
    }
    // `id` is applied as an `in.()` list below, not as an equality filter.
    const equality = Object.entries(where).filter(([k]) => k !== "id");
    let rows = TASKS.filter((t) => equality.every(([k, v]) => String(t[k] ?? "") === v));
    // PostgREST encodes `in.(a,b)` as `id=in.(a,b)` — strip the wrapper and split.
    const inIds = params.get("id")?.match(/in\.\(([^)]*)\)/)?.[1]?.split(",") ?? null;
    if (inIds) rows = rows.filter((t) => inIds.includes(t.id));
    const shaped = rows.map((t) => ({
      ...t,
      task_assignees: wantsEmbed
        ? ASSIGNEES.filter((a) => a.task_id === t.id).map((a) => ({ user_id: a.user_id, position: a.position }))
        : undefined,
    }));
    return respond(200, shaped);
  }

  if (table === "task_assignees") {
    const rows = ASSIGNEES.filter((a) => Object.entries(where).every(([k, v]) => String(a[k] ?? "") === v));
    return respond(200, rows.map((a) => (select === "task_id" ? { task_id: a.task_id } : a)));
  }

  return respond(200, []);
}

/* -------------------------------------------------------------------------- */
/* Load the store with `fetch` and `server-only` swapped out                  */
/* -------------------------------------------------------------------------- */

const cache = new Map();
const STUBS = {
  "server-only": {},
  "next/headers": {
    cookies: async () => ({ get: () => undefined, set() {}, delete() {}, getAll: () => [] }),
  },
};

global.fetch = (url, init) => Promise.resolve(fakeFetch(url, init));
globalThis.Headers = globalThis.Headers ?? function () {};

function loadTs(relPath) {
  const abs = path.join(ROOT, relPath);
  if (cache.has(abs)) return cache.get(abs);
  const js = ts.transpileModule(fs.readFileSync(abs, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(abs, mod.exports);
  const localRequire = (spec) => {
    if (STUBS[spec]) return STUBS[spec];
    if (spec.startsWith(".") || spec.startsWith("@/")) {
      const base = spec.startsWith("@/")
        ? path.join(ROOT, "src", spec.slice(2))
        : path.resolve(path.dirname(abs), spec);
      for (const candidate of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) {
        if (fs.existsSync(candidate)) return loadTs(path.relative(ROOT, candidate));
      }
    }
    return require(spec);
  };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(mod.exports, mod, localRequire);
  return mod.exports;
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

console.log("=== supabase query shapes ===");

(async () => {
  const { SupabaseStore } = loadTs("src/lib/data/supabase.ts");
  const store = new SupabaseStore();

  // Show what the store actually asks for, once, while developing this suite.
  if (process.env.DEBUG_QUERIES) {
    await store.listTasks(ORG, { onlyForUser: ME }).catch(() => null);
    for (const r of log) console.log("    →", r.method, r.table, "where", JSON.stringify(r.where), "select", r.select);
  }

  await checkAsync("'my tasks' does not send an embedded column inside or()", async () => {
    log.length = 0;
    const rows = await store.listTasks(ORG, { onlyForUser: ME });
    const bad = log.filter((r) => r.or && /task_assignees\./.test(r.or));
    assert(bad.length === 0, `the store still sends or=${bad[0]?.or} — PostgREST rejects this`);
    return `${rows.length} task(s)`;
  });

  await checkAsync("…it returns the lead's tasks *and* the shared ones", async () => {
    const rows = await store.listTasks(ORG, { onlyForUser: ME });
    const titles = rows.map((t) => t.title).sort();
    assert(titles.length === 2, `expected 2 tasks, got ${JSON.stringify(titles)}`);
    assert(titles.includes("Led by me"), "the task I lead is missing");
    assert(titles.includes("Shared with me"), "the task I am second on is missing");
    assert(!titles.includes("Nothing to do with me"), "somebody else's task leaked in");
    return titles.join(" · ");
  });

  await checkAsync("a shared task carries everybody on it, lead first", async () => {
    const rows = await store.listTasks(ORG, { onlyForUser: ME });
    const shared = rows.find((t) => t.title === "Shared with me");
    const list = shared.assigneeIds ?? [];
    assert(list[0] === OTHER, `lead should be the first entry, got ${list[0]}`);
    assert(list.includes(ME), "the second assignee is missing");
    return list.map((id) => id.slice(0, 4)).join(" → ");
  });

  await checkAsync("the dialog can list every task for a team", async () => {
    const rows = await store.listTasks(ORG, { status: "pending" });
    assert(rows.length === 2, `expected 2 pending tasks, got ${rows.length}`);
    return rows.map((t) => t.title).join(" · ");
  });

  await checkAsync("a project without 0010 still lists tasks (lead only)", async () => {
    hasAssigneesTable = false;
    try {
      const rows = await store.listTasks(ORG, { onlyForUser: ME });
      assert(rows.length === 1, `expected the one task I lead, got ${rows.length}`);
      assert(rows[0].title === "Led by me", rows[0].title);
      const all = await store.listTasks(ORG);
      assert(all.length === 3, `expected 3 tasks, got ${all.length}`);
      return "degrades to the lead column, no 500";
    } finally {
      hasAssigneesTable = true;
    }
  });

  await checkAsync("…and creating a task does not fail on the missing table", async () => {
    hasAssigneesTable = false;
    try {
      await store.setTaskAssignees(ORG, "t1", [ME]);
      return "silently skipped";
    } finally {
      hasAssigneesTable = true;
    }
  });

  check("the store never builds or=(…task_assignees…) anywhere", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/lib/data/supabase.ts"), "utf8");
    assert(
      !/or\(`[^`]*task_assignees\./.test(src),
      "supabase.ts puts an embedded column inside or() — the exact bug that broke /app/my-tasks",
    );
    return "two indexed queries instead";
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
