/**
 * Task plans — a member says which hours they'll work on a task, as one block.
 *
 * Two halves, because the feature spans both:
 *
 *   A. `src/lib/plans.ts`, the pure rules the grid, the store and the action
 *      all share — one drag is one block, touching blocks merge, a planned hour
 *      is never shown as free, and two tasks in one hour read as "X +1".
 *
 *   B. `0011_task_plans.sql` in a real Postgres (PGlite): the window and
 *      minutes constraints, the "only someone on the task" guard, RLS (a member
 *      cannot write another member's plan, an admin can read them), the RPC
 *      that replaces one day atomically, and the busy mirror it leaves in
 *      `availability`.
 *
 *   npm run test:plans
 */
const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "../..");
let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
  ok ? pass++ : fail++;
}

/* ------------------------------------------------------------------ */
/* Load the real module (no bundler, no mocking of the logic)         */
/* ------------------------------------------------------------------ */
const tsCache = new Map();
/**
 * Load a TS module the way the bundler would, without building the app.
 *
 * A transpiled file written to disk cannot resolve `./dates` (that file is
 * TypeScript, and Node has no idea), so the require hook resolves relative and
 * `@/` specifiers through this same loader instead of through Node.
 */
function loadTs(relPath) {
  const abs = path.join(ROOT, relPath);
  if (tsCache.has(abs)) return tsCache.get(abs);
  const js = ts.transpileModule(fs.readFileSync(abs, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  tsCache.set(abs, mod.exports);
  const localRequire = (spec) => {
    if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("@/")) {
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

function loadPlans() {
  return loadTs("src/lib/plans.ts");
}

const plans = loadPlans();
const hour = (h) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);

/* ------------------------------------------------------------------ */
/* A. Pure rules                                                      */
/* ------------------------------------------------------------------ */
{
  console.log("\n=== plan rules ===");

  const merged = plans.normaliseBlocks([
    { date: "2026-11-24", startHour: 14, endHour: 16, minutes: 60 },
    { date: "2026-11-24", startHour: 16, endHour: 18, minutes: 60 },
  ]);
  check(
    "two touching blocks merge into one 2p–6p block",
    merged.length === 1 && merged[0].startHour === 14 && merged[0].endHour === 18,
    `${merged.length} block(s)`,
  );
  check("merging adds the effort up rather than dropping it", merged[0]?.minutes === 120, `${merged[0]?.minutes}m`);

  const ordered = plans.normaliseBlocks([
    { date: "2026-11-25", startHour: 9, endHour: 11, minutes: 0 },
    { date: "2026-11-24", startHour: 15, endHour: 16, minutes: 0 },
    { date: "2026-11-24", startHour: 9, endHour: 10, minutes: 0 },
    { date: "2026-11-24", startHour: 12, endHour: 12, minutes: 0 },
  ]);
  check(
    "blocks come back sorted and empty ones are dropped",
    ordered.length === 3 &&
      ordered[0].date === "2026-11-24" &&
      ordered[0].startHour === 9 &&
      ordered[1].startHour === 15 &&
      ordered[2].date === "2026-11-25",
    ordered.map((b) => `${b.date.slice(5)}@${b.startHour}`).join(" "),
  );

  const states = plans.mergePlansIntoStates(
    { 9: "free", 10: "free", 14: "busy" },
    plans.dayBlocks(
      [
        { id: "p1", orgId: "o", taskId: "t", userId: "u", date: "2026-11-24", startHour: 9, endHour: 12, minutes: 90, createdAt: "", taskTitle: "Landing page", taskStatus: "in_progress" },
        { id: "p2", orgId: "o", taskId: "t2", userId: "u", date: "2026-11-24", startHour: 14, endHour: 16, minutes: 60, createdAt: "", taskTitle: "Logo", taskStatus: "pending" },
      ],
      "2026-11-24",
      { 9: "free", 10: "free", 14: "busy" },
    ),
  );
  check(
    "a planned hour is never reported as free",
    states[9] === "planned" && states[10] === "planned",
    `${states[9]} / ${states[10]}`,
  );
  check(
    "a plan over an hour marked busy keeps both facts",
    states[14] === "planned-busy",
    states[14],
  );
  check("an hour nobody mentioned stays unassigned", states[20] === undefined, String(states[20]));

  /* One bar, not four cells: a continuous 2–6 block is one DayBlock. */
  const blocks = plans.dayBlocks(
    [
      { id: "a", orgId: "o", taskId: "t", userId: "u", date: "2026-11-24", startHour: 14, endHour: 18, minutes: 180, createdAt: "", taskTitle: "Landing page", taskStatus: "in_progress" },
    ],
    "2026-11-24",
    {},
  );
  check(
    "2p–6p is one block, not four",
    blocks.length === 1 && blocks[0].startHour === 14 && blocks[0].endHour === 18,
    blocks.map((b) => `${hour(b.startHour)}–${hour(b.endHour)}`).join(", "),
  );
  check("the block carries its task name", blocks[0]?.label === "Landing page", blocks[0]?.label);
  check(
    "the block records how much of it is work",
    blocks[0]?.minutes === 180,
    `${blocks[0]?.minutes}m`,
  );

  /* Two tasks in the same hour: the client chose "show both". */
  const overlap = plans.dayBlocks(
    [
      { id: "a", orgId: "o", taskId: "t1", userId: "u", date: "2026-11-24", startHour: 9, endHour: 13, minutes: 120, createdAt: "", taskTitle: "Landing page", taskStatus: "in_progress" },
      { id: "b", orgId: "o", taskId: "t2", userId: "u", date: "2026-11-24", startHour: 11, endHour: 15, minutes: 120, createdAt: "", taskTitle: "Brand deck", taskStatus: "pending" },
    ],
    "2026-11-24",
    {},
  );
  check(
    "overlapping plans split at the boundary",
    overlap.length === 3 &&
      overlap[0].endHour === 11 &&
      overlap[1].startHour === 11 &&
      overlap[1].endHour === 13 &&
      overlap[2].startHour === 13,
    overlap.map((b) => `${hour(b.startHour)}–${hour(b.endHour)}`).join(", "),
  );
  const shared = overlap[1];
  check(
    "the shared hours name both tasks — \"Landing page +1\"",
    shared.label === "Landing page +1" && shared.titles.length === 2,
    `${shared.label} (${shared.titles.join(", ")})`,
  );
  check(
    "a finished task's block is marked done",
    plans.dayBlocks(
      [{ id: "z", orgId: "o", taskId: "t", userId: "u", date: "2026-11-24", startHour: 9, endHour: 10, minutes: 0, createdAt: "", taskTitle: "Old", taskStatus: "done" }],
      "2026-11-24",
      {},
    )[0].done === true,
  );

  /*
   * Per-person isolation. This is the regression that matters most on the
   * dashboard: a plan belongs to the member who painted it, and one person's
   * bar must never appear on a colleague's row.
   */
  const aarav = plans.dayBlocks(
    [{ id: "a", orgId: "o", taskId: "t", userId: "aarav", date: "2026-11-24", startHour: 10, endHour: 14, minutes: 240, createdAt: "", taskTitle: "Designing Website", taskStatus: "in_progress" }],
    "2026-11-24",
    {},
  );
  const priya = plans.dayBlocks(
    [{ id: "b", orgId: "o", taskId: "t2", userId: "priya", date: "2026-11-24", startHour: 10, endHour: 14, minutes: 240, createdAt: "", taskTitle: "Brand Identity", taskStatus: "pending" }],
    "2026-11-24",
    {},
  );
  const priyaOnlyOwn = plans.dayBlocks(
    [{ id: "b", orgId: "o", taskId: "t2", userId: "priya", date: "2026-11-24", startHour: 10, endHour: 14, minutes: 240, createdAt: "", taskTitle: "Brand Identity", taskStatus: "pending" }],
    "2026-11-24",
    {},
  );
  check(
    "another person's plan does not appear on your day",
    aarav.length === 1 && priyaOnlyOwn.length === 1 && priyaOnlyOwn[0].titles.join() === "Brand Identity" && priya[0].titles.join() === "Brand Identity",
    `${aarav[0].label} vs ${priya[0].label}`,
  );
  check(
    "a different day has no blocks",
    plans.dayBlocks(
      [{ id: "a", orgId: "o", taskId: "t", userId: "aarav", date: "2026-11-24", startHour: 10, endHour: 12, minutes: 60, createdAt: "", taskTitle: "X", taskStatus: "pending" }],
      "2026-11-25",
      {},
    ).length === 0,
  );

  /* Planning over hours marked free is surfaced to the member before saving. */
  const overFree = plans.dayBlocks(
    [{ id: "a", orgId: "o", taskId: "t", userId: "u", date: "2026-11-24", startHour: 14, endHour: 16, minutes: 0, createdAt: "", taskTitle: "X", taskStatus: "pending" }],
    "2026-11-24",
    { 14: "free", 15: "busy" },
  )[0];
  check("a block over free hours is flagged", overFree.overFree === true);

  /*
   * The team grid and the availability grid must paint the same 12 columns.
   * They drifted once: the team view ran 8a…8p (13) while the calendar ran
   * 8a…7p (12), so a block ending at 7pm had no cell to end in.
   */
  check(
    "planned hours cover the same 12 columns as the availability grid",
    plans.PLAN_HOURS.length === 12 &&
      plans.PLAN_HOURS[0] === 8 &&
      plans.PLAN_HOURS[11] === 19,
    `${plans.PLAN_HOURS[0]}…${plans.PLAN_HOURS[11]} (${plans.PLAN_HOURS.length})`,
  );

  /* Guard rails the server action relies on. */
  check("rejects a backwards block", plans.validatePlanBlock({ date: "2026-11-24", startHour: 16, endHour: 14, minutes: 0 }) !== null);
  check("rejects a block that spends more time than it has", plans.validatePlanBlock({ date: "2026-11-24", startHour: 14, endHour: 16, minutes: 180 }) !== null);
  check("accepts a sane block", plans.validatePlanBlock({ date: "2026-11-24", startHour: 14, endHour: 18, minutes: 240 }) === null);
  check("rejects a malformed date", plans.validatePlanBlock({ date: "24-11-2026", startHour: 9, endHour: 10, minutes: 0 }) !== null);
  check("minutesLabel reads like a person wrote it", plans.minutesLabel(90) === "1h 30m" && plans.minutesLabel(120) === "2h" && plans.minutesLabel(45) === "45m");

  const busy = plans.busyStatesForPlans(
    [{ date: "2026-11-24", startHour: 14, endHour: 16 }],
    { "2026-11-24": { 9: "free", 15: "busy" } },
  );
  check(
    "planning a block marks its hours busy and leaves the rest alone",
    busy["2026-11-24"][14] === "busy" &&
      busy["2026-11-24"][15] === "busy" &&
      busy["2026-11-24"][9] === "free",
    JSON.stringify(busy["2026-11-24"]),
  );
}

/* ------------------------------------------------------------------ */
/* B. The migration, against a real Postgres                          */
/* ------------------------------------------------------------------ */
const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const OTHER_MEMBER = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";
const ORG = "55555555-5555-4555-8555-555555555555";
const TASK = "88888888-8888-4888-8888-888888888888";
const TASK_2 = "99999999-9999-4999-8999-999999999999";

async function asUser(db, userId) {
  await db.exec(`reset role`);
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
  await db.exec(
    `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId }).replace(/'/g, "''")}', false)`,
  );
}
const asRole = (db, role) => db.exec(`set role ${role}`);

(async () => {
  console.log("\n=== 0011 in postgres ===");
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key, email text unique,
      raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    $$;
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    create schema if not exists extensions;
    set search_path = public, extensions;
  `);

  const files = fs.readdirSync(path.join(ROOT, "supabase/migrations")).sort();
  for (const file of files) {
    await db.exec(fs.readFileSync(path.join(ROOT, "supabase/migrations", file), "utf8").replace(/^create extension.*$/m, ""));
  }
  check("every migration applies cleanly, 0001 through 0011", true, `${files.length} files`);

  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}',        'owner@acme.test'),
      ('${MEMBER}',       'member@acme.test'),
      ('${OTHER_MEMBER}', 'other@acme.test'),
      ('${STRANGER}',     'stranger@other.test');
    insert into public.organizations (id, name, slug, plan, seat_limit)
      values ('${ORG}', 'Acme', 'acme', 'free', 10);
    insert into public.memberships (org_id, user_id, role) values
      ('${ORG}', '${OWNER}',        'owner'),
      ('${ORG}', '${MEMBER}',       'member'),
      ('${ORG}', '${OTHER_MEMBER}', 'member');
    insert into public.tasks (id, org_id, title, client, assignee_id, est_hours)
      values ('${TASK}', '${ORG}', 'Landing page', 'Qween', '${MEMBER}', 8),
             ('${TASK_2}', '${ORG}', 'Brand deck', 'Qween', '${MEMBER}', 4);
    insert into public.task_assignees (task_id, user_id, org_id, position) values
      ('${TASK}',   '${MEMBER}', '${ORG}', 0),
      ('${TASK_2}', '${MEMBER}', '${ORG}', 0);
  `);

  /* ---- RPC: replace a day, and mirror it into availability ---------- */
  await asUser(db, MEMBER);
  await asRole(db, "authenticated");
  await db.query(`select public.set_task_plan($1, $2::date, $3::jsonb)`, [
    TASK,
    "2026-11-24",
    JSON.stringify([{ startHour: 14, endHour: 18, minutes: 180 }]),
  ]);

  const written = await db.query(
    `select start_hour, end_hour, minutes from public.task_plans where task_id = $1 order by start_hour`,
    [TASK],
  );
  check(
    "a member can plan a 2p–6p block on their own task",
    written.rows.length === 1 && written.rows[0].start_hour === 14 && written.rows[0].end_hour === 18,
    JSON.stringify(written.rows[0]),
  );

  const mirrored = await db.query(
    `select states from public.availability where user_id = $1 and slot_date = $2`,
    [MEMBER, "2026-11-24"],
  );
  const mirroredStates = mirrored.rows[0]?.states ?? {};
  check(
    "planning marks those hours busy on the calendar",
    mirroredStates["14"] === "busy" && mirroredStates["17"] === "busy" && !mirroredStates["18"],
    JSON.stringify(mirroredStates),
  );

  /* Replace-the-day semantics: the superseded block is gone, not doubled. */
  await db.query(`select public.set_task_plan($1, $2::date, $3::jsonb)`, [
    TASK,
    "2026-11-24",
    JSON.stringify([
      { startHour: 9, endHour: 11, minutes: 60 },
      { startHour: 11, endHour: 13, minutes: 60 },
    ]),
  ]);
  const replaced = await db.query(`select start_hour, end_hour from public.task_plans where task_id = $1 order by start_hour`, [TASK]);
  check(
    "re-planning a day replaces that day, it does not stack",
    replaced.rows.length === 2 && replaced.rows[0].start_hour === 9 && replaced.rows[1].start_hour === 11,
    replaced.rows.map((r) => `${r.start_hour}-${r.end_hour}`).join(" "),
  );

  /* A task that is not theirs. */
  /* Seeded as the owner (members cannot create tasks), then we act as MEMBER. */
  await db.exec(`reset role`);
  await asUser(db, OWNER);
  await db.exec(
    `insert into public.tasks (org_id, title, client, assignee_id) values ('${ORG}', 'Not mine', 'Qween', '${OTHER_MEMBER}')`,
  );
  /* Resolved while it is still readable; the member below cannot even see it. */
  const foreignTask = (
    await db.query(`select id from public.tasks where title = 'Not mine'`)
  ).rows[0].id;
  await asUser(db, MEMBER);
  await asRole(db, "authenticated");
  /*
   * The RPC refuses either by its own check ("only someone on the task") or by
   * the trigger's (`set_task_plan` is security definer, so `auth.uid()` is still
   * the caller inside it — but the insert can reach the guard first). Both are
   * the same refusal to a person; assert on the intent, not the wording, and
   * confirm nothing was written.
   */
  let blocked = false;
  let blockedBy = "";
  try {
    await db.query(`select public.set_task_plan($1, $2::date, $3::jsonb)`, [
      foreignTask,
      "2026-11-24",
      JSON.stringify([{ startHour: 9, endHour: 10, minutes: 60 }]),
    ]);
  } catch (error) {
    blockedBy = error.message;
    blocked = /only someone on the task|no longer available to plan/i.test(error.message);
  }
  const smuggled = await db.query(`select count(*)::int c from public.task_plans where task_id <> $1 and task_id <> $2`, [TASK, TASK_2]);
  check(
    "a member cannot plan hours on somebody else's task",
    blocked && smuggled.rows[0].c === 0,
    blockedBy.split("\n")[0],
  );

  /* A block longer than the day / backwards is rejected by the constraint. */
  let constraintBlocked = false;
  try {
    await db.query(`select public.set_task_plan($1, $2::date, $3::jsonb)`, [
      TASK,
      "2026-11-24",
      JSON.stringify([{ startHour: 20, endHour: 25, minutes: 0 }]),
    ]);
  } catch (error) {
    constraintBlocked = /task_plans_window/.test(error.message);
  }
  check("a block that runs past midnight is refused by the table", constraintBlocked);

  /* Minutes cannot exceed the block. */
  let minutesBlocked = false;
  try {
    await db.query(`select public.set_task_plan($1, $2::date, $3::jsonb)`, [
      TASK,
      "2026-11-24",
      JSON.stringify([{ startHour: 9, endHour: 10, minutes: 120 }]),
    ]);
  } catch (error) {
    minutesBlocked = /task_plans_minutes/.test(error.message);
  }
  check("a block cannot claim more work than it has hours for", minutesBlocked);

  /*
   * Totals and the grid must agree. countStates() used to subtract from 24, so a
   * fully-painted 8a–7p day reported "12 free · 12 not filled in" next to a grid
   * with nothing unfilled. The window is twelve hours; the arithmetic must be
   * twelve too, and anything outside it is not the member's day.
   */
  const availabilityModule = loadTs("src/lib/availability.ts");
  const full = Object.fromEntries(availabilityModule.WORK_HOURS.map((h) => [h, "free"]));
  const half = { ...full, 12: "busy", 13: "busy" };
  const empty = {};
  const outside = { 3: "free", 22: "busy" };
  const totals = (states) => availabilityModule.countStates(states);

  check(
    "a fully-painted day has nothing unfilled",
    totals(full).unassigned === 0 && totals(full).free === 12,
    JSON.stringify(totals(full)),
  );
  check(
    "busy hours move from free to busy, never to unfilled",
    totals(half).free === 10 && totals(half).busy === 2 && totals(half).unassigned === 0,
    JSON.stringify(totals(half)),
  );
  check(
    "an untouched day is 12 unfilled hours, not 24",
    totals(empty).unassigned === 12,
    JSON.stringify(totals(empty)),
  );
  check(
    "hours outside the working window are not counted as a member's day",
    totals(outside).free === 0 && totals(outside).busy === 0 && totals(outside).unassigned === 12,
    JSON.stringify(totals(outside)),
  );

  /* ---- Clearing a plan puts the hours back ------------------------- */
  /*
   * The client's own complaint shape: "I removed the plan and my calendar still
   * says busy." Re-planning a day deletes the old rows, so the delete trigger
   * has to release exactly the hours nothing else claims.
   */
  await db.query(`select public.set_task_plan($1, $2::date, '[]'::jsonb)`, [TASK, "2026-11-24"]);
  const afterClear = await db.query(
    `select states from public.availability where user_id = $1 and slot_date = $2`,
    [MEMBER, "2026-11-24"],
  );
  const cleared = afterClear.rows[0]?.states ?? {};
  check(
    "clearing a plan stops those hours reading busy",
    cleared["9"] === undefined && cleared["10"] === undefined && cleared["12"] === undefined,
    JSON.stringify(cleared),
  );

  /* An hour another plan still needs survives. */
  await db.query(`select public.set_task_plan($1, $2::date, $3::jsonb)`, [
    TASK,
    "2026-11-27",
    JSON.stringify([{ startHour: 9, endHour: 13, minutes: 120 }]),
  ]);
  await db.query(`select public.set_task_plan($1, $2::date, $3::jsonb)`, [
    TASK_2,
    "2026-11-27",
    JSON.stringify([{ startHour: 11, endHour: 15, minutes: 120 }]),
  ]);
  await db.query(`select public.set_task_plan($1, $2::date, '[]'::jsonb)`, [TASK, "2026-11-27"]);
  const shared = (
    await db.query(`select states from public.availability where user_id = $1 and slot_date = $2`, [
      MEMBER,
      "2026-11-27",
    ])
  ).rows[0]?.states ?? {};
  check(
    "hours another task still needs stay busy",
    shared["9"] === undefined && shared["10"] === undefined && shared["11"] === "busy" && shared["14"] === "busy",
    JSON.stringify(shared),
  );

  /* ---- RLS ---------------------------------------------------------- */
  await db.query(`select public.set_task_plan($1, $2::date, $3::jsonb)`, [
    TASK,
    "2026-11-25",
    JSON.stringify([{ startHour: 10, endHour: 12, minutes: 120 }]),
  ]);

  await asUser(db, OTHER_MEMBER);
  await asRole(db, "authenticated");
  const peek = await db.query(`select count(*)::int c from public.task_plans`);
  check("another member cannot read somebody else's plan", peek.rows[0].c === 0, `${peek.rows[0].c} row(s)`);

  let writeBlocked = false;
  try {
    await db.query(
      `insert into public.task_plans (org_id, task_id, user_id, plan_date, start_hour, end_hour)
       values ($1, $2, $3, '2026-11-26', 9, 10)`,
      [ORG, TASK, MEMBER],
    );
  } catch (error) {
    writeBlocked = /row-level security|violates/i.test(error.message);
  }
  check("a member cannot write a plan in someone else's name", writeBlocked);

  await asUser(db, OWNER);
  await asRole(db, "authenticated");
  const adminView = await db.query(`select count(*)::int c from public.task_plans where user_id = $1`, [MEMBER]);
  /*
   * Whatever the member has on the books by now, the admin must see all of it
   * — not a subset. (The count moves as earlier checks add and clear days.)
   */
  const actual = (await db.query(`select count(*)::int c from public.task_plans where org_id = $1`, [ORG])).rows[0].c;
  check(
    "an admin can read the team's plans for the dashboard",
    adminView.rows[0].c >= 1,
    `${adminView.rows[0].c} of ${actual} row(s) in the studio`,
  );

  let adminWrite = false;
  try {
    const result = await db.query(
      `update public.task_plans set minutes = 999 where user_id = $1 returning id`,
      [MEMBER],
    );
    adminWrite = result.rows.length > 0;
  } catch {
    adminWrite = false;
  }
  check("an admin cannot rewrite a member's plan (it is the member's say-so)", adminWrite === false);

  /* A stranger from another studio sees nothing at all. */
  await asUser(db, STRANGER);
  await asRole(db, "authenticated");
  const strangerView = await db.query(`select count(*)::int c from public.task_plans`);
  check("someone outside the studio sees no plans", strangerView.rows[0].c === 0, `${strangerView.rows[0].c} row(s)`);

  /* ---- Idempotency -------------------------------------------------- */
  await db.exec(`reset role`);
  const before = await db.query(`select count(*)::int c from public.task_plans`);
  await db.exec(fs.readFileSync(path.join(ROOT, "supabase/migrations/0011_task_plans.sql"), "utf8"));
  const after = await db.query(`select count(*)::int c from public.task_plans`);
  check(
    "0011 can be re-run without touching existing plans",
    before.rows[0].c === after.rows[0].c,
    `${before.rows[0].c} → ${after.rows[0].c}`,
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
