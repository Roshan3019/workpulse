-- ============================================================================
-- reset-data.sql — wipe every row, keep every table, column, policy and function
-- ============================================================================
--
-- Use this to get back to a truly empty studio before testing from scratch:
-- no studios, no people, no tasks, no teams, no availability, no invites,
-- no join links, no join requests, no audit trail, no auth users.
--
-- It deletes DATA only. It never drops or alters a table, column, index,
-- constraint, policy, trigger or function, and it does not touch the
-- migration history — so the schema stays exactly as the migrations left it
-- and re-running the migrations does nothing.
--
-- How to run
--   Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
--   Then, in Authentication -> Users, the list should be empty.
--
-- Safe to run more than once: everything is already gone the second time.
--
-- What is deliberately NOT cleared
--   * public.app_settings — configuration (e.g. the service-role key used to
--     send invite emails), not user data. Delete it yourself if you want the
--     app back to "no email delivery": delete from public.app_settings;
--   * storage buckets and objects — the app never writes any, so they stay put;
--   * auth.users rows created after you run this (obviously).
-- ============================================================================

begin;

-- 1. Studio data. One statement, children before parents, so the read-only
--    guards on some tables cannot trip on a half-empty database. `cascade`
--    only follows foreign keys *into* these tables, never out of them, so no
--    structural object is touched.
truncate table
  public.task_assignees,
  public.tasks,
  public.availability,
  public.team_members,
  public.teams,
  public.join_requests,
  public.join_links,
  public.invites,
  public.audit_log,
  public.memberships,
  public.organizations
  cascade;

-- 2. Auth users. auth.sessions, auth.identities, auth.refresh_tokens and
--    public.profiles all hang off auth.users with ON DELETE CASCADE, so this
--    single delete also empties them. Deleting a user is what makes a signup
--    with the same email work again ("already registered" would otherwise come
--    from the orphaned auth row, not from profiles).
delete from auth.users;

commit;

-- 3. Report what is left (every count should be 0).
select 'organizations'  as table_name, count(*) as rows from public.organizations
union all select 'memberships',    count(*) from public.memberships
union all select 'profiles',       count(*) from public.profiles
union all select 'teams',          count(*) from public.teams
union all select 'team_members',   count(*) from public.team_members
union all select 'tasks',          count(*) from public.tasks
union all select 'task_assignees', count(*) from public.task_assignees
union all select 'availability',   count(*) from public.availability
union all select 'invites',        count(*) from public.invites
union all select 'join_links',     count(*) from public.join_links
union all select 'join_requests',  count(*) from public.join_requests
union all select 'audit_log',      count(*) from public.audit_log
union all select 'auth.users',     count(*) from auth.users
union all select 'auth.identities',count(*) from auth.identities
union all select 'auth.sessions',  count(*) from auth.sessions
order by table_name;
