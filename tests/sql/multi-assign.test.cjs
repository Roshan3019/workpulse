/**
 * Multi-assign + free-plan regression test — real migrations, real Postgres
 * (PGlite).
 *
 * Guards the database half of round 10:
 *
 *   1. `0010` adds `task_assignees`, backfills every existing task's lead, and
 *      keeps the two in step;
 *   2. a shared task is visible to *everyone* on it, not only the lead;
 *   3. a member can still only move progress/status on their own task, and
 *      cannot rewrite who is on it;
 *   4. nobody from another studio can be attached to a task;
 *   5. organisations on the free plan get 10 seats.
 *
 *   npm run test:join
 */
const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const sql = (file) => fs.readFileSync(path.join(ROOT, "supabase/migrations", file), "utf8");

const OWNER = "11111111-1111-4111-8111-111111111111";
const DESIGNER = "22222222-2222-4222-8222-222222222222";
const SECOND = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";
const ORG = "55555555-5555-4555-8555-555555555555";
const OTHER_ORG = "66666666-6666-4666-8666-666666666666";
const TEAM = "77777777-7777-4777-8777-777777777777";
const TASK = "88888888-8888-4888-8888-888888888888";

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
  ok ? pass++ : fail++;
}

async function asUser(db, userId) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
  await db.exec(
    `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId }).replace(/'/g, "''")}', false)`,
  );
}

async function bootstrap(db) {
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
}

(async () => {
  const db = new PGlite();
  await bootstrap(db);

  /*
   * Two phases, because the backfill is the point: 0001–0009 build the schema
   * the app runs on today, then the fixture inserts a task the *old* way —
   * one `assignee_id`, no join rows — and only then does 0010 run.
   */
  const files = fs.readdirSync(path.join(ROOT, "supabase/migrations")).sort();
  const split = files.indexOf("0010_multi_assign_tasks.sql");
  if (split < 0) throw new Error("0010_multi_assign_tasks.sql is missing");
  for (const file of files.slice(0, split)) {
    await db.exec(sql(file).replace(/^create extension.*$/m, ""));
  }
  check("migrations 0001–0009 apply cleanly", true, `${split} files`);

  /* ------------------------------------------------------------------ */
  /* Fixture: a studio with a task that predates multi-assign           */
  /* ------------------------------------------------------------------ */
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}',    'owner@acme.test'),
      ('${DESIGNER}', 'designer@acme.test'),
      ('${SECOND}',   'second@acme.test'),
      ('${STRANGER}', 'stranger@other.test');

    insert into public.organizations (id, name, slug, plan, seat_limit) values
      ('${ORG}',       'Acme Studio',  'acme',       'free', 10),
      ('${OTHER_ORG}', 'Other Studio', 'other-buro', 'free', 10);

    insert into public.memberships (org_id, user_id, role) values
      ('${ORG}',       '${OWNER}',    'owner'),
      ('${ORG}',       '${DESIGNER}', 'member'),
      ('${ORG}',       '${SECOND}',   'member'),
      ('${OTHER_ORG}', '${STRANGER}', 'owner');

    insert into public.teams (id, org_id, name, slug) values ('${TEAM}', '${ORG}', 'Web', 'web');

    -- Written the old way: one assignee, no join rows yet.
    insert into public.tasks (id, org_id, title, client, assignee_id, est_hours, team_id)
      values ('${TASK}', '${ORG}', 'Old single-assignee task', 'Qween', '${DESIGNER}', 6, '${TEAM}');
  `);

  for (const file of files.slice(split)) {
    await db.exec(sql(file).replace(/^create extension.*$/m, ""));
  }
  check("0010 applies on top of a populated database", true, files.slice(split).join(", "));

  const backfilled = await db.query(`select user_id, position from public.task_assignees where task_id = $1`, [TASK]);
  check(
    "an old single-assignee task is backfilled into task_assignees",
    backfilled.rows.length === 1 && backfilled.rows[0].user_id === DESIGNER,
    `${backfilled.rows.length} row(s)`,
  );

  /* ------------------------------------------------------------------ */
  /* Idempotency: running 0010 twice must not duplicate anything        */
  /* ------------------------------------------------------------------ */
  await db.exec(sql("0010_multi_assign_tasks.sql").replace(/^create extension.*$/m, ""));
  const afterRerun = await db.query(`select count(*)::int c from public.task_assignees where task_id = $1`, [TASK]);
  check("0010 can be re-run without duplicating rows", afterRerun.rows[0].c === 1, `${afterRerun.rows[0].c} row(s)`);

  /* ------------------------------------------------------------------ */
  /* The owner shares the task with a second person                     */
  /* ------------------------------------------------------------------ */
  await asUser(db, OWNER);
  await db.exec(`set role authenticated`);

  await db.exec(`
    insert into public.task_assignees (task_id, user_id, org_id, position)
      values ('${TASK}', '${SECOND}', '${ORG}', 1);
  `);
  const members = await db.query(
    `select user_id from public.task_assignees where task_id = $1 order by position`,
    [TASK],
  );
  check(
    "a second person can be added to the task",
    members.rows.length === 2 && members.rows[1].user_id === SECOND,
    members.rows.map((r) => r.user_id.slice(0, 4)).join(" → "),
  );

  const guard = await db
    .query(
      `insert into public.task_assignees (task_id, user_id, org_id, position)
         values ('${TASK}', '${STRANGER}', '${ORG}', 2) returning user_id`,
    )
    .then(() => null)
    .catch((error) => error.message);
  check(
    "someone from another studio cannot be attached",
    typeof guard === "string" && /not a member of this studio/.test(guard),
    String(guard).slice(0, 60),
  );

  await db.exec(`reset role`);

  /* ------------------------------------------------------------------ */
  /* Visibility, checked as the second assignee                         */
  /* ------------------------------------------------------------------ */
  await asUser(db, SECOND);
  await db.exec(`set role authenticated`);
  const roster = await db.query(
    `select user_id from public.task_assignees where task_id = $1 order by position`,
    [TASK],
  );
  check(
    "…and can see everyone else on the task",
    roster.rows.length === 2,
    `${roster.rows.length} people`,
  );

  const seenBySecond = await db.query(`select id, title from public.tasks where id = $1`, [TASK]);
  check(
    "a shared task is visible to the second person",
    seenBySecond.rows.length === 1,
    String(seenBySecond.rows[0]?.title ?? "not visible"),
  );
  await db.exec(`reset role`);

  await asUser(db, STRANGER);
  await db.exec(`set role authenticated`);
  const seenByStranger = await db.query(`select id from public.tasks where id = $1`, [TASK]);
  check("…and invisible to somebody outside the studio", seenByStranger.rows.length === 0);
  await db.exec(`reset role`);

  /* ------------------------------------------------------------------ */
  /* A member may move progress, not the roster                         */
  /* ------------------------------------------------------------------ */
  await asUser(db, SECOND);
  await db.exec(`set role authenticated`);
  const progress = await db
    .query(`update public.tasks set progress = 40, status = 'in_progress' where id = $1 returning progress`, [TASK])
    .then((r) => r.rows[0]?.progress)
    .catch((e) => `error: ${e.message}`);
  check("a member on the task can update progress", progress === 40, String(progress));

  const rewrite = await db
    .query(`update public.tasks set assignee_id = '${SECOND}' where id = $1 returning id`, [TASK])
    .then(() => null)
    .catch((e) => e.message);
  check(
    "…but cannot take the task over from its lead",
    typeof rewrite === "string" && /only update progress and status/.test(rewrite),
    String(rewrite).slice(0, 60),
  );
  await db.exec(`reset role`);

  await asUser(db, OWNER);
  await db.exec(`set role authenticated`);
  const ownerEdit = await db
    .query(`update public.tasks set title = 'Renamed by the owner' where id = $1 returning title`, [TASK])
    .then((r) => r.rows[0]?.title)
    .catch((e) => `error: ${e.message}`);
  check("the owner can still edit every field", ownerEdit === "Renamed by the owner", String(ownerEdit));
  await db.exec(`reset role`);

  /* ------------------------------------------------------------------ */
  /* Free plan: 10 seats                                                */
  /* ------------------------------------------------------------------ */
  const seats = (
    await db.query(`select column_default from information_schema.columns
                    where table_schema = 'public' and table_name = 'organizations' and column_name = 'seat_limit'`)
  ).rows[0]?.column_default;
  check("the organisations table defaults to 10 seats", /10/.test(String(seats)), String(seats));

  await asUser(db, STRANGER);
  const created = (await db.query(`select public.create_organization('Ten Seats Studio') as id`)).rows[0].id;
  const createdSeats = (await db.query(`select seat_limit, plan from public.organizations where id = $1`, [created]))
    .rows[0];
  check(
    "a new studio starts on 10 seats",
    createdSeats?.seat_limit === 10 && createdSeats?.plan === "free",
    `${createdSeats?.plan} · ${createdSeats?.seat_limit} seats`,
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error("HARNESS ERROR:", error);
  process.exit(1);
});
