/**
 * Invite-link regression test — runs the real migrations on a real Postgres.
 *
 * Reproduces the production crash first:
 *   load organization: invalid input syntax for type uuid: ""
 * which happened because the invite page tried to load an org for a
 * logged-out visitor (RLS hides `invites`, so nothing could be resolved).
 *
 *   npm run test:invite
 */
const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const sql = (file) => fs.readFileSync(path.join(ROOT, "supabase/migrations", file), "utf8");

const ADMIN = "11111111-1111-1111-1111-111111111111";
const MEMBER = "22222222-2222-2222-2222-222222222222";
const ORG = "33333333-3333-3333-3333-333333333333";

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
  ok ? pass++ : fail++;
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
    create or replace function auth.role() returns text language sql stable as $$ select 'anon'::text; $$;
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
    create schema if not exists extensions;
    set search_path = public, extensions;
  `);
}

(async () => {
  const db = new PGlite();
  await bootstrap(db);
  await db.exec(sql("0001_init.sql"));
  await db.exec(sql("0002_fix_invite_token.sql"));

  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}','owner@acme.test'), ('${MEMBER}','mate@acme.test');
    -- profiles rows are created by the on_auth_user_created trigger; just name them
    update public.profiles set full_name = 'Owner' where id = '${ADMIN}';
    update public.profiles set full_name = 'Mate'  where id = '${MEMBER}';
    insert into public.organizations (id, name, slug, plan, seat_limit)
      values ('${ORG}','Acme Studio','acme','free',5);
    insert into public.memberships (org_id, user_id, role) values
      ('${ORG}','${ADMIN}','owner'), ('${ORG}','${MEMBER}','member');
  `);

  /* ---------- create an invite as the admin ---------- */
  await db.exec(`select set_config('request.jwt.claim.sub','${ADMIN}',false)`);
  const token = (await db.query(`select public.create_invite($1,'newbie@acme.test','member') as t`, [ORG]))
    .rows[0].t;
  check("admin can create an invite", /^[0-9a-f]{64}$/.test(token));

  /* ---------- the bug: a signed-out visitor ---------- */
  await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
  // The harness connects as a superuser, which bypasses RLS. PostgREST runs as
  // `anon`/`authenticated`, so switch role to see what a visitor really sees.
  // `anon` has no table grant at all (0001 grants tables to `authenticated`), which
  // is itself part of why the page must go through the RPC. Test the authenticated
  // case too: a signed-in outsider still sees nothing thanks to RLS.
  let anonDenied = null;
  try {
    await db.exec(`set role anon`);
    await db.query(`select count(*) from public.invites`);
  } catch (e) {
    anonDenied = e.message.split("\n")[0];
  }
  await db.exec(`reset role`);
  check("anon cannot read invites at all (no grant)", Boolean(anonDenied), anonDenied || "readable!");

  await db.exec(`set role authenticated`);
  const anonRows = await db.query(`select count(*)::int c from public.invites`);
  check(
    "signed in as an outsider, RLS hides invites (why the page crashed)",
    anonRows.rows[0].c === 0,
    `${anonRows.rows[0].c} rows visible`,
  );

  let previewMissing = null;
  try {
    await db.query(`select * from public.invite_preview($1)`, [token]);
  } catch (e) {
    previewMissing = e.message.split("\n")[0];
  }
  await db.exec(`reset role`);
  check(
    "before 0003 the RPC does not exist (reproduces the failure)",
    Boolean(previewMissing),
    previewMissing || "unexpectedly present",
  );

  /* ---------- apply the fix ---------- */
  await db.exec(sql("0003_invite_preview_and_email.sql"));
  check("0003 applies cleanly", true);

  const preview = await db.query(`select * from public.invite_preview($1)`, [token]);
  const row = preview.rows[0];
  check(
    "signed OUT: invite_preview resolves the team name",
    row?.org_name === "Acme Studio",
    JSON.stringify(row),
  );
  check("signed OUT: preview exposes the invited email", row?.email === "newbie@acme.test");
  check("signed OUT: preview exposes the role", row?.role === "member");
  check("preview does NOT leak the token or inviter", !("token" in (row ?? {})) && !("invited_by" in (row ?? {})));

  const unknown = await db.query(`select * from public.invite_preview('deadbeef')`);
  check("unknown token returns no rows (page shows 'link invalid')", unknown.rows.length === 0);

  /* ---------- expired + used links ---------- */
  const expired = (await db.query(
    `insert into public.invites (org_id, email, role, expires_at)
     values ($1,'old@acme.test','member', now() - interval '1 day') returning token`,
    [ORG],
  )).rows[0].token;
  const exp = await db.query(`select * from public.invite_preview($1)`, [expired]);
  check("expired invite is not resolvable", exp.rows.length === 0);

  await db.exec(`update public.invites set accepted_at = now() where token = '${token}'`);
  const used = await db.query(`select * from public.invite_preview($1)`, [token]);
  check("already-accepted invite is not resolvable", used.rows.length === 0);

  /* ---------- settings are not world-readable ---------- */
  const cols = await db.query(
    `select count(*)::int c from information_schema.role_table_grants
      where table_name = 'app_settings' and grantee in ('anon','authenticated')`,
  );
  check("app_settings has no anon/authenticated grants", cols.rows[0].c === 0, `${cols.rows[0].c} grants`);

  await db.exec(`select public.set_setting('project_url','https://demo.supabase.co')`);
  const setting = await db.query(`select value from public.app_settings where key = 'project_url'`);
  check("set_setting() stores a value", setting.rows[0]?.value === "https://demo.supabase.co");

  /* ---------- the email trigger must never block invite creation ---------- */
  await db.exec(`select set_config('request.jwt.claim.sub','${ADMIN}',false)`);
  const emailInvite = await db.query(`select public.create_invite($1,'emailed@acme.test','member') as t`, [ORG]);
  check(
    "invite creation still succeeds with the email trigger installed",
    /^[0-9a-f]{64}$/.test(emailInvite.rows[0].t),
  );

  const shareLink = await db.query(`select public.create_invite($1,null,'member') as t`, [ORG]);
  check("shareable link (no email) still works", /^[0-9a-f]{64}$/.test(shareLink.rows[0].t));

  /* ---------- idempotency ---------- */
  await db.exec(sql("0003_invite_preview_and_email.sql"));
  const again = await db.query(`select * from public.invite_preview($1)`, [shareLink.rows[0].t]);
  check("re-running 0003 is safe and preview still works", Boolean(again.rows[0]));

  // Back to the admin for the next fixture (set_config persists per session).
  await db.exec(`select set_config('request.jwt.claim.sub','${ADMIN}',false)`);

  /* ---------- a new signup can accept and become a member ---------- */
  const NEWBIE = "44444444-4444-4444-8444-444444444444";
  await db.exec(`insert into auth.users (id, email) values ('${NEWBIE}','newbie@acme.test')`);

  // Shareable link (no email) created by the admin — the new account accepts it.
  await db.exec(`select set_config('request.jwt.claim.sub','${ADMIN}',false)`);
  const shareable = (await db.query(`select public.create_invite($1, null, 'member') as t`, [ORG])).rows[0].t;

  // …then the brand-new user (no membership anywhere) accepts it.
  await db.exec(`select set_config('request.jwt.claim.sub','${NEWBIE}',false)`);
  const accepted = await db.query(`select public.accept_invite($1) as org`, [shareable]);
  check("a brand-new account can accept an invite", accepted.rows[0].org === ORG, accepted.rows[0].org);
  const member = await db.query(
    `select role from public.memberships where org_id = $1 and user_id = $2`,
    [ORG, NEWBIE],
  );
  check("accepted invite creates the membership as 'member'", member.rows[0]?.role === "member");

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exit(1);
});
