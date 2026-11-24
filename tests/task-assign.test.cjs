#!/usr/bin/env node
/**
 * npm run test:tasks
 *
 * Drives the *real* `saveTaskAction` — validation, the team rule, the store
 * writes — with Next's request primitives stubbed out.
 *
 * Why this exists: the client's report was "I assigned a task to a team and it
 * never showed up in that team", and the cause was in the action (it never read
 * the team, and it only ever stored one assignee). A UI test would not have
 * caught it; a test that calls the action with the form a browser posts does.
 *
 * The stubs are deliberately minimal: cookies (who is signed in), revalidatePath
 * (a no-op), redirect (throws, like Next), and react.cache (identity, since
 * there is no render in progress).
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

let errorShown = false;
process.on("unhandledRejection", (reason) => {
  if (!errorShown) {
    errorShown = true;
    console.log(`\n=== 1 failed (unhandled) ===\n${reason && reason.stack}`);
    process.exit(1);
  }
});

/* -------------------------------------------------------------------------- */
/* Load a .ts module, with the Next/spike modules stubbed                     */
/* -------------------------------------------------------------------------- */

const COOKIE_STATE = { userId: null };

const STUBS = {
  "server-only": {},
  // Identity cache: there is no React render in progress here.
  react: { ...require("react"), cache: (fn) => fn },
  "next/cache": { revalidatePath() {}, revalidateTag() {} },
  "next/navigation": {
    redirect(url) {
      const error = new Error(`NEXT_REDIRECT ${url}`);
      error.digest = `NEXT_REDIRECT;replace;${url};307;`;
      throw error;
    },
    notFound() {
      throw new Error("NEXT_NOT_FOUND");
    },
  },
  "next/headers": {
    cookies: async () => ({
      get: (name) => (name === "wp_demo_user" && COOKIE_STATE.userId ? { value: COOKIE_STATE.userId } : undefined),
      set() {},
      delete() {},
      getAll: () => [],
    }),
    headers: async () => new Headers({ host: "localhost:8080" }),
  },
};

const cache = new Map();
function loadTs(relPath) {
  const abs = path.join(ROOT, relPath);
  if (cache.has(abs)) return cache.get(abs);
  const source = fs.readFileSync(abs, "utf8");
  const js = ts.transpileModule(source, {
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
      for (const candidate of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (fs.existsSync(candidate)) return loadTs(path.relative(ROOT, candidate));
      }
    }
    return require(spec);
  };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(mod.exports, mod, localRequire);
  return mod.exports;
}

const { MemoryStore, resetMemoryDatabase } = loadTs("src/lib/data/memory.ts");
const { DEMO_ORG_ID, DEMO_USERS } = loadTs("src/lib/data/types.ts");

/* The action module resolves the store through `../data`, which builds a
 * Supabase client unless demo mode is on — so this suite pins demo mode. */
process.env.NEXT_PUBLIC_SUPABASE_URL = "";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";

console.log("=== task assignment (action) ===");

const OWNER = DEMO_USERS[0].id;
const WEB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const AARAV = "44444444-4444-4444-8444-444444444444"; // Web
const NEHA = "77777777-7777-4777-8777-777777777777"; // Web
const PRIYA = "55555555-5555-4555-8555-555555555555"; // Branding

/* -------------------------------------------------------------------------- */
/* Helpers: the exact form a browser posts                                    */
/* -------------------------------------------------------------------------- */

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const item of value) data.append(key, String(item));
    else data.append(key, String(value));
  }
  return data;
}

const baseFields = {
  title: "Shared landing page",
  client: "Qween",
  description: "two designers, one brief",
  estHours: "6",
  progress: "0",
  status: "pending",
  priority: "high",
  deadline: "2026-12-01",
  startDate: "2026-11-24",
  dueTime: "17:00",
};

(async () => {
  resetMemoryDatabase();
  COOKIE_STATE.userId = OWNER;
  const { saveTaskAction, deleteTaskAction } = loadTs("src/lib/actions/tasks.ts");
  const store = new MemoryStore();

  /* ---------------- one person, team filled in automatically -------------- */
  const single = await saveTaskAction(form({ ...baseFields, assigneeIds: [AARAV], teamId: "" }));
  check("the action accepts one assignee", () => assert(single.ok && !single.error, JSON.stringify(single)));

  const afterSingle = await store.listTasks(DEMO_ORG_ID, { teamId: WEB });
  const singleTask = afterSingle.find((t) => t.title === baseFields.title);
  check("the task lands on Team 1 with no team chosen", () => {
    assert(singleTask, "the task is not in the Web team's list — this is the reported bug");
    return singleTask.teamId === WEB ? "teamId = Web" : `wrong team ${singleTask.teamId}`;
  });

  /* ---------------- several people at once -------------------------------- */
  const many = await saveTaskAction(
    form({ ...baseFields, title: "Two designers", assigneeIds: [AARAV, NEHA], teamId: "" }),
  );
  check("the action accepts several assignees", () => assert(many.ok, JSON.stringify(many)));

  const shared = (await store.listTasks(DEMO_ORG_ID)).find((t) => t.title === "Two designers");
  check("both people are stored, in the order picked", () => {
    assert(shared, "task missing");
    const list = shared.assigneeIds ?? [];
    assert(list.length === 2, `got ${list.length} assignees`);
    assert(list[0] === AARAV, "the first pick should be the lead");
    return list.join(" + ");
  });
  check("the lead is mirrored into assigneeId", () => shared.assigneeId === AARAV);

  const nehaView = await store.listTasks(DEMO_ORG_ID, { onlyForUser: NEHA });
  check("a shared task shows in the second person's own list", () => assert(nehaView.some((t) => t.id === shared.id)));
  const teamView = await store.listTasks(DEMO_ORG_ID, { teamId: WEB });
  check("…and in the team's task list", () => assert(teamView.some((t) => t.id === shared.id)));

  /* ---------------- forcing the wrong team warns -------------------------- */
  const forced = await saveTaskAction(
    form({ ...baseFields, title: "Forced team", assigneeIds: [AARAV], teamId: BRAND }),
  );
  check("forcing Team 2 with a Team 1 person still saves", () => assert(forced.ok, JSON.stringify(forced)));
  check("…but comes back with a warning naming the team", () => {
    assert(forced.message, "no warning was returned");
    assert(/Branding/.test(forced.message), `warning does not name the team: ${forced.message}`);
    return forced.message;
  });

  /* ---------------- validation ------------------------------------------- */
  const none = await saveTaskAction(form({ ...baseFields, title: "Nobody", assigneeIds: [], teamId: WEB }));
  check("a task with nobody on it is refused", () => {
    assert(!none.ok && /at least one person/i.test(none.error ?? ""), JSON.stringify(none));
    return none.error;
  });

  const stranger = await saveTaskAction(
    form({ ...baseFields, title: "Outsider", assigneeIds: ["aaaaaaaa-1111-4111-8111-111111111111"], teamId: "" }),
  );
  check("someone outside the studio cannot be assigned", () => {
    assert(!stranger.ok, JSON.stringify(stranger));
    return stranger.error;
  });

  const badTeam = await saveTaskAction(
    form({ ...baseFields, title: "Wrong studio team", assigneeIds: [AARAV], teamId: "88888888-8888-4888-8888-888888888888" }),
  );
  check("a team from another studio is refused", () => {
    assert(!badTeam.ok, JSON.stringify(badTeam));
    return badTeam.error;
  });

  /* ---------------- editing ---------------------------------------------- */
  const edit = await saveTaskAction(
    form({ ...baseFields, id: singleTask.id, title: "Shared landing page", assigneeIds: [AARAV, PRIYA], teamId: WEB }),
  );
  check("editing can add a second person", () => assert(edit.ok, JSON.stringify(edit)));
  const edited = (await store.listTasks(DEMO_ORG_ID)).find((t) => t.id === singleTask.id);
  check("…and the task now names both", () => (edited.assigneeIds ?? []).length === 2);
  check("…keeping the chosen team, with a warning for the outsider", () => {
    assert(edited.teamId === WEB, `team is ${edited.teamId}`);
    assert(/One person you picked is not in Web/.test(edit.message ?? ""), String(edit.message));
    return edit.message;
  });

  /* ---------------- delete still works ---------------------------------- */
  const removed = await deleteTaskAction(singleTask.id);
  check("a task can still be deleted", () => assert(removed.ok));
  await checkAsync("…and it leaves the team list", async () => {
    const rows = await store.listTasks(DEMO_ORG_ID, { teamId: WEB });
    assert(!rows.some((t) => t.id === singleTask.id));
    return "gone";
  });

  /* ---------------- members cannot assign ------------------------------- */
  COOKIE_STATE.userId = AARAV;
  let memberOutcome = "allowed (bad)";
  try {
    const asMember = await saveTaskAction(form({ ...baseFields, title: "Sneaky", assigneeIds: [AARAV], teamId: WEB }));
    memberOutcome = JSON.stringify(asMember);
  } catch (error) {
    // requireAdmin() redirects non-admins — that throw *is* the refusal.
    const digest = /** @type {any} */ (error).digest ?? String(error.message);
    memberOutcome = /NEXT_REDIRECT.*my-tasks/.test(digest) ? "refused" : `unexpected: ${digest}`;
  }
  check("a member cannot create tasks", () => {
    assert(memberOutcome === "refused", memberOutcome);
    return "sent to their own task list";
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
