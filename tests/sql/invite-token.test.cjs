// Reproduction + regression test for the gen_random_bytes invite bug.
// Emulates Supabase: pgcrypto installed in the `extensions` schema, `auth` schema present.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');

// PGlite has no pgcrypto, but the real Supabase DB already has it installed, so
// the `create extension` line is dropped when replaying the historical migration.
const OLD_0001 = execSync('git show 5e78397:supabase/migrations/0001_init.sql', { cwd: ROOT })
  .toString().replace(/^create extension if not exists pgcrypto;$/m, '');
const NEW_0001 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0001_init.sql'), 'utf8');
const NEW_0002 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0002_fix_invite_token.sql'), 'utf8');

const ADMIN = '11111111-1111-1111-1111-111111111111';
const MEMBER = '22222222-2222-2222-2222-222222222222';
const ORG = '33333333-3333-3333-3333-333333333333';

async function bootstrap(db) {
  // Supabase-style auth schema
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key,
      email text unique,
      raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz default now());
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create or replace function auth.role() returns text language sql stable as $$ select 'authenticated'::text; $$;
  `);
  // Supabase's default roles
  await db.exec(`
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
  `);
  // Supabase installs pgcrypto into the `extensions` schema (NOT public), so the
  // functions exist but are invisible to anything running `search_path = public`.
  // This PGlite build has no pgcrypto, so stub the two functions it provides in
  // that exact schema — behaviourally identical to Supabase's layout.
  await db.exec(`
    create schema if not exists extensions;
    create or replace function extensions.gen_random_bytes(n int) returns bytea
      language sql volatile as $$ select decode(repeat(md5(random()::text), 4), 'hex') $$;
    create or replace function extensions.encode(data bytea, format text) returns text
      language sql immutable as $$ select encode(data, format) $$;
  `);
  // Supabase's SQL Editor session runs with `extensions` on its search_path,
  // which is why the migration itself applied successfully in production.
  await db.exec(`set search_path = public, extensions;`);
  console.log('  [setup] pgcrypto-equivalent funcs in schema "extensions" + SQL-Editor search_path (mirrors Supabase)');
}

async function fixture(db) {
  await db.exec(`
    insert into auth.users (id,email) values ('${ADMIN}','admin@acme.test'), ('${MEMBER}','member@acme.test')
      on conflict do nothing;
    insert into public.profiles (id,email,full_name) values
      ('${ADMIN}','admin@acme.test','Admin'), ('${MEMBER}','member@acme.test','Member')
      on conflict do nothing;
    insert into public.organizations (id,name,slug,plan,seat_limit) values
      ('${ORG}','Acme','acme-${Date.now()}','free',5) on conflict do nothing;
    insert into public.memberships (org_id,user_id,role) values
      ('${ORG}','${ADMIN}','owner'), ('${ORG}','${MEMBER}','member')
      on conflict do nothing;
  `);
}

async function asUser(db, uid) {
  await db.exec(`select set_config('request.jwt.claim.sub','${uid}', false)`);
}

async function tryCreateInvite(db, email) {
  const r = await db.query(
    `select public.create_invite($1, $2, 'member'::public.org_role) as token`, [ORG, email]);
  return r.rows[0].token;
}

(async () => {
  let pass = 0, fail = 0;
  const check = (name, ok, detail = '') => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
    ok ? pass++ : fail++;
  };

  // ---------- Scenario A: the user's live database (OLD 0001 already applied) ----------
  console.log('\nSCENARIO A — existing prod DB with old 0001 applied, then run 0002_fix_invite_token.sql');
  const a = new PGlite();
  await bootstrap(a);
  await a.exec(OLD_0001);
  await fixture(a);
  await asUser(a, ADMIN);

  let repro = null;
  try { await tryCreateInvite(a, 'adaniuniversity1218@gmail.com'); }
  catch (e) { repro = e.message; }
  check('reproduces the exact production error before the fix',
    !!repro && /gen_random_bytes\(integer\) does not exist/.test(repro), repro || 'no error raised');

  // The column default resolves against the *session* search_path, so it may work
  // in SQL Editor yet fail for PostgREST inserts. What matters is the expression.
  const oldDefault = await a.query(`select column_default from information_schema.columns
    where table_schema='public' and table_name='invites' and column_name='token'`);
  check('old default references pgcrypto gen_random_bytes (latent bug)',
    /gen_random_bytes/.test(oldDefault.rows[0].column_default || ''), oldDefault.rows[0].column_default);

  await a.exec(NEW_0002);
  console.log('  [applied] 0002_fix_invite_token.sql');

  const token = await tryCreateInvite(a, 'adaniuniversity1218@gmail.com');
  check('create_invite succeeds after the fix', typeof token === 'string' && token.length > 0, `token ${token}`);
  check('token is 64 lowercase hex chars (256-bit)', /^[0-9a-f]{64}$/.test(token || ''), token);

  const row = await a.query(`select email, role, token from public.invites where token = $1`, [token]);
  check('invite row stored with correct email/role',
    row.rows[0]?.email === 'adaniuniversity1218@gmail.com' && row.rows[0]?.role === 'member',
    JSON.stringify(row.rows[0]));

  const audit = await a.query(`select action from public.audit_log where action = 'invite.created'`);
  check('audit_log entry written', audit.rows.length === 1);

  const tok2 = await tryCreateInvite(a, 'second@acme.test');
  check('tokens are unique across invites', tok2 !== token);

  const def = await a.query(`insert into public.invites (org_id,email,role) values ($1,'direct@y.test','member') returning token`, [ORG]);
  check('column default now works for direct inserts', /^[0-9a-f]{64}$/.test(def.rows[0].token), def.rows[0].token);

  check('0002 is idempotent (re-run safe)', await a.exec(NEW_0002).then(() => true).catch(e => { console.log('    ', e.message); return false; }));
  const tokenAfterRerun = await tryCreateInvite(a, 'again@acme.test');
  check('create_invite still works after re-running 0002', /^[0-9a-f]{64}$/.test(tokenAfterRerun || ''));

  await asUser(a, MEMBER);
  let denied = null;
  try { await tryCreateInvite(a, 'nope@acme.test'); } catch (e) { denied = e.message; }
  check('non-admin still blocked ("Not allowed")', /Not allowed/.test(denied || ''), denied);

  await asUser(a, ADMIN);
  let seatErr = null;
  try {
    await a.exec(`update public.organizations set seat_limit = (select count(*) from public.memberships) where id = '${ORG}'`);
    await tryCreateInvite(a, 'over@acme.test');
  } catch (e) { seatErr = e.message; }
  check('seat limit still enforced after the fix', /Seat limit reached/.test(seatErr || ''), seatErr);

  // ---------- Scenario B: brand-new project using the fixed 0001 ----------
  console.log('\nSCENARIO B — fresh install using the fixed 0001_init.sql');
  const b = new PGlite();
  await bootstrap(b);
  await b.exec(NEW_0001);
  await fixture(b);
  await asUser(b, ADMIN);
  const freshToken = await tryCreateInvite(b, 'fresh@acme.test');
  check('create_invite works on a fresh database', /^[0-9a-f]{64}$/.test(freshToken || ''), freshToken);
  const freshDef = await b.query(`insert into public.invites (org_id,email,role) values ($1,'d@y.test','member') returning token`, [ORG]);
  check('fresh install token default works', /^[0-9a-f]{64}$/.test(freshDef.rows[0].token), freshDef.rows[0].token);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
