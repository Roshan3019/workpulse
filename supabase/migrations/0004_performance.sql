-- ============================================================================
-- 0004_performance.sql — make the hot read paths cheap
--
-- Safe to run on an existing project. New projects: run 0001, then this, then
-- 0003 (order after 0001 does not matter).
--
-- Two independent problems, both invisible on a laptop and obvious against a
-- network-attached database:
--
--  1. RLS policies call auth.uid() once per row.
--     auth.uid() reads a per-transaction setting, and because a plain SQL
--     function call is not a constant Postgres cannot hoist it out of the row
--     loop — so a 200-row task list evaluates it 200 times. Wrapping it as
--     `(select auth.uid())` turns it into an InitPlan that runs once per
--     query. This is Supabase's documented recommendation and is exactly
--     behaviour-preserving: same predicate, same rows, evaluated once.
--
--     Note: only auth.uid() is rewrapped here. Calls like
--     public.is_org_admin(org_id) take the row's own column as an argument
--     and legitimately differ per row, so they are left alone. Every policy
--     name, role and expression below is otherwise identical to 0001.
--
--  2. A few foreign keys used on every page had no supporting index, so
--     Postgres scanned whole tables for joins and lookups.
--
-- Idempotent: indexes are IF NOT EXISTS, policies are DROP + CREATE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Indexes on the columns the app filters, joins and orders by
-- ---------------------------------------------------------------------------

-- "My tasks" — tasks where assignee_id = me, scoped to the org.
create index if not exists tasks_org_assignee_idx
  on public.tasks (org_id, assignee_id);

-- Dashboard and task list ordering by due date.
create index if not exists tasks_org_deadline_idx
  on public.tasks (org_id, deadline);

-- Availability is read as (org, user list, date list) on every dashboard.
create index if not exists availability_org_user_date_idx
  on public.availability (org_id, user_id, slot_date);

-- listMembers() joins memberships → profiles.
create index if not exists memberships_org_user_idx
  on public.memberships (org_id, user_id);

-- The invite page looks a token up directly.
create index if not exists invites_token_idx
  on public.invites (token);

-- ---------------------------------------------------------------------------
-- 2. Evaluate auth.uid() once per query instead of once per row
-- ---------------------------------------------------------------------------

-- PROFILES -------------------------------------------------------------------
drop policy if exists profiles_select_self_or_teammate on public.profiles;
create policy profiles_select_self_or_teammate on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships me
      join public.memberships them on them.org_id = me.org_id
      where me.user_id = (select auth.uid()) and them.user_id = profiles.id
    )
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- MEMBERSHIPS ----------------------------------------------------------------
drop policy if exists memberships_delete_admin on public.memberships;
create policy memberships_delete_admin on public.memberships
  for delete to authenticated
  using (public.is_org_admin(org_id) and user_id <> (select auth.uid()));

-- TASKS ----------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    public.is_org_admin(org_id) or assignee_id = (select auth.uid())
  );

drop policy if exists tasks_update_assignee on public.tasks;
create policy tasks_update_assignee on public.tasks
  for update to authenticated
  using (assignee_id = (select auth.uid()))
  with check (assignee_id = (select auth.uid()));

-- AVAILABILITY ---------------------------------------------------------------
drop policy if exists availability_select on public.availability;
create policy availability_select on public.availability
  for select to authenticated
  using (public.is_org_admin(org_id) or user_id = (select auth.uid()));

drop policy if exists availability_write_own on public.availability;
create policy availability_write_own on public.availability
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_org_member(org_id));

drop policy if exists availability_update_own on public.availability;
create policy availability_update_own on public.availability
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists availability_delete_own on public.availability;
create policy availability_delete_own on public.availability
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. Refresh planner statistics for the small, constantly-read tables
-- ---------------------------------------------------------------------------
analyze public.organizations;
analyze public.memberships;
analyze public.profiles;
analyze public.tasks;
analyze public.availability;
analyze public.invites;
