/**
 * Join-flow regression test — real migrations, real Postgres (PGlite).
 *
 * Reproduces the three things the client hit with a real account:
 *
 *   1. the admin inbox showed "No name given" for every request;
 *   2. asking twice could leave two rows for the same person;
 *   3. a person whose request was declined could not ask again.
 *
 * Plus the new guarantee that a request never needs a studio first:
 * `request_to_join` only requires a signed-in user.
 *
 *   npm run test:join
 */
const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const sql = (file) => fs.readFileSync(path.join(ROOT, "supabase/migrations", file), "utf8");

const ADMIN = "11111111-1111-4111-8111-111111111111";
const OUTSIDER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
  ok ? pass++ : fail++;
}

/** Sign a request as `userId`, with the claims GoTrue would put in the JWT. */
async function asUser(db, userId, claims = {}) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
  await db.exec(
    `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, ...claims }).replace(/'/g, "''")}', false)`,
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

  for (const file of fs.readdirSync(path.join(ROOT, "supabase/migrations")).sort()) {
    // This PGlite build has no pgcrypto; PGCrypto only matters for defaults the
    // harness never exercises, and the real project already has it.
    await db.exec(sql(file).replace(/^create extension.*$/m, ""));
  }
  check("all migrations apply cleanly", true, `${fs.readdirSync(path.join(ROOT, "supabase/migrations")).length} files`);

  /* --------------------------------------------------------------------- */
  /* Fixture: an admin with a studio, and an outsider with no studio at all */
  /* --------------------------------------------------------------------- */
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}',    'owner@acme.test',    '{"full_name":"Owner Person"}'::jsonb),
      ('${OUTSIDER}', 'newbie@acme.test',   '{"full_name":"New Bie","avatar_url":"https://img.test/a.png"}'::jsonb);
    insert into public.organizations (id, name, slug, plan, seat_limit)
      values ('${ORG}', 'Acme Studio', 'acme', 'free', 5);
    insert into public.memberships (org_id, user_id, role) values ('${ORG}', '${ADMIN}', 'owner');
    -- The outsider's profile exists (signup trigger) but arrived with no name —
    -- exactly the state that produced "No name given" in the inbox.
    update public.profiles set full_name = null, avatar_url = null where id = '${OUTSIDER}';
  `);

  await asUser(db, ADMIN, { email: "owner@acme.test" });
  const link = (await db.query(`select * from public.ensure_join_link($1)`, [ORG])).rows[0];
  check("the admin has a join link", /^[0-9a-f]{32,}$/.test(link.token), link.token.slice(0, 8));

  /* --------------------------------------------------------------------- */
  /* 1. Asking needs no studio                                              */
  /* --------------------------------------------------------------------- */
  await asUser(db, OUTSIDER, {
    email: "newbie@acme.test",
    user_metadata: { full_name: "New Bie", avatar_url: "https://img.test/a.png" },
  });

  const noMembership = await db.query(
    `select count(*)::int c from public.memberships where user_id = $1`,
    [OUTSIDER],
  );
  check("the requester has no studio of their own", noMembership.rows[0].c === 0);

  const first = await db.query(`select * from public.request_to_join($1, $2)`, [link.token, "Please accept"]);
  check("a studio-less account can send a request", first.rows[0]?.already_pending === false);

  /* --------------------------------------------------------------------- */
  /* 2. The admin can see who asked                                        */
  /* --------------------------------------------------------------------- */
  await asUser(db, ADMIN, { email: "owner@acme.test" });
  await db.exec(`set role authenticated`);

  const inbox = await db.query(
    `select r.id, r.user_id, r.note, r.status,
            p.full_name, p.email, p.avatar_url
       from public.join_requests r
       left join public.profiles p on p.id = r.user_id
      where r.org_id = $1 and r.status = 'pending'
      order by r.created_at`,
    [ORG],
  );
  await db.exec(`reset role`);

  const row = inbox.rows[0];
  check("the request reaches the admin inbox", inbox.rows.length === 1);
  check("the admin can read the requester's name", row?.full_name === "New Bie", String(row?.full_name));
  check("the admin can read the requester's email", row?.email === "newbie@acme.test", String(row?.email));
  check("the avatar comes through too", row?.avatar_url === "https://img.test/a.png");
  check("the note is kept", row?.note === "Please accept");

  /* The profile backfill is what fixed it, so prove the row itself is filled. */
  const filled = await db.query(`select full_name from public.profiles where id = $1`, [OUTSIDER]);
  check("a nameless profile is backfilled from the JWT", filled.rows[0]?.full_name === "New Bie");

  /* --------------------------------------------------------------------- */
  /* 3. Asking twice never duplicates — and can update the note             */
  /* --------------------------------------------------------------------- */
  await asUser(db, OUTSIDER, { email: "newbie@acme.test", user_metadata: { full_name: "New Bie" } });
  const second = await db.query(`select * from public.request_to_join($1, $2)`, [link.token, "Second try"]);
  const count = await db.query(
    `select count(*)::int c from public.join_requests where org_id = $1 and user_id = $2 and status = 'pending'`,
    [ORG, OUTSIDER],
  );
  check("asking twice is idempotent", second.rows[0]?.already_pending === true && count.rows[0].c === 1, `${count.rows[0].c} rows`);

  await asUser(db, ADMIN, { email: "owner@acme.test" });
  await db.exec(`set role authenticated`);
  const afterRetry = await db.query(
    `select note from public.join_requests where org_id = $1 and user_id = $2 and status = 'pending'`,
    [ORG, OUTSIDER],
  );
  await db.exec(`reset role`);
  check("the latest note replaces the old one", afterRetry.rows[0]?.note === "Second try", String(afterRetry.rows[0]?.note));

  /* --------------------------------------------------------------------- */
  /* 4. Approving admits them — and ends the waiting state                  */
  /* --------------------------------------------------------------------- */
  await asUser(db, ADMIN, { email: "owner@acme.test" });
  await db.query(`select public.decide_join_request($1, $2, true)`, [ORG, row.id]);

  const member = await db.query(
    `select role from public.memberships where org_id = $1 and user_id = $2`,
    [ORG, OUTSIDER],
  );
  check("approval creates the membership as a member", member.rows[0]?.role === "member");

  await asUser(db, OUTSIDER, { email: "newbie@acme.test" });
  const mine = await db.query(`select * from public.my_join_requests()`);
  check("my_join_requests is empty once approved", mine.rows.length === 0);

  /* --------------------------------------------------------------------- */
  /* 5. A declined request can be sent again                                */
  /* --------------------------------------------------------------------- */
  const THIRD = "44444444-4444-4444-8444-444444444444";
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data)
      values ('${THIRD}', 'third@acme.test', '{"full_name":"Third Person"}'::jsonb);
  `);

  await asUser(db, THIRD, { email: "third@acme.test", user_metadata: { full_name: "Third Person" } });
  await db.query(`select * from public.request_to_join($1, null)`, [link.token]);

  const pendingMine = await db.query(`select * from public.my_join_requests()`);
  check("the requester can see their own pending request", pendingMine.rows.length === 1);
  check("it names the studio", pendingMine.rows[0]?.org_name === "Acme Studio");

  await asUser(db, ADMIN, { email: "owner@acme.test" });
  const thirdRows = await db.query(
    `select id from public.join_requests where org_id = $1 and user_id = $2 and status = 'pending'`,
    [ORG, THIRD],
  );
  await db.query(`select public.decide_join_request($1, $2, false)`, [ORG, thirdRows.rows[0].id]);

  await asUser(db, THIRD, { email: "third@acme.test", user_metadata: { full_name: "Third Person" } });
  const declinedMine = await db.query(`select * from public.my_join_requests()`);
  check("a decision clears the waiting state", declinedMine.rows.length === 0);

  const retry = await db.query(`select * from public.request_to_join($1, 'Trying again')`, [link.token]);
  check("a declined person can ask again", retry.rows[0]?.already_pending === false);

  /* --------------------------------------------------------------------- */
  /* 6. A member cannot ask, and the token is not exposed to requesters     */
  /* --------------------------------------------------------------------- */
  await asUser(db, OUTSIDER, { email: "newbie@acme.test" });
  let blocked = null;
  try {
    await db.query(`select * from public.request_to_join($1, null)`, [link.token]);
  } catch (error) {
    blocked = error.message.split("\n")[0];
  }
  check("someone already in the studio cannot ask", Boolean(blocked), blocked || "allowed!");

  const signature = await db.query(
    `select pg_get_function_result(p.oid) as cols
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'my_join_requests'`,
  );
  const columns = signature.rows[0]?.cols ?? "";
  check(
    "my_join_requests never hands the link token back",
    columns.length > 0 && !/token/.test(columns),
    columns.replace(/\s+/g, " ").slice(0, 120),
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error("HARNESS ERROR:", error.message);
  process.exit(1);
});
