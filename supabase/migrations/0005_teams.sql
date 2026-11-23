-- ============================================================================
-- 0005_teams.sql — teams inside a studio
--
-- A studio (organization) can now run several teams — "Web", "Branding",
-- "Video" — each with its own roster. The admin dashboard gets a switcher:
-- Overall, or one team at a time.
--
-- Decisions behind the shape (confirmed with the client):
--   • A task belongs to exactly one team. `team_id` is nullable so tasks
--     created before teams existed are simply studio-wide rather than lost.
--   • A person can be in several teams. That is the many-to-many table below,
--     not a column on memberships.
--   • Team membership is scoped to the org on every row, so the existing
--     is_org_member()/is_org_admin() policies compose without a subquery
--     through teams.
-- ============================================================================

create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 60),
  -- Generated from the name, used in URLs (/app/team/<slug>) so links are
  -- readable. Unique per studio, not globally.
  slug       text not null check (char_length(trim(slug)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table if not exists public.team_members (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- Tasks gain an optional team. Existing rows stay null (studio-wide).
alter table public.tasks
  add column if not exists team_id uuid references public.teams(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists teams_org_idx          on public.teams (org_id);
create index if not exists team_members_org_idx   on public.team_members (org_id, user_id);
create index if not exists team_members_team_idx  on public.team_members (team_id);
-- The dashboard filters tasks by team on every load.
create index if not exists tasks_org_team_idx     on public.tasks (org_id, team_id);
-- Deleting a team must not leave a task pointing at nothing — handled by the
-- ON DELETE SET NULL above, which needs an index on the referencing column to
-- be cheap at scale.
create index if not exists tasks_team_idx         on public.tasks (team_id);

-- ---------------------------------------------------------------------------
-- Keep updated_at fresh on rename (matches every other table in 0001)
-- ---------------------------------------------------------------------------
drop trigger if exists teams_touch on public.teams;
create trigger teams_touch
  before update on public.teams
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Everyone in the studio can read the team list and rosters (the dashboard
-- needs them). Only admins/owners may create, rename, delete teams or change
-- who is on them.
-- ---------------------------------------------------------------------------
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;

drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists teams_insert_admin on public.teams;
create policy teams_insert_admin on public.teams
  for insert to authenticated with check (public.is_org_admin(org_id));

drop policy if exists teams_update_admin on public.teams;
create policy teams_update_admin on public.teams
  for update to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop policy if exists teams_delete_admin on public.teams;
create policy teams_delete_admin on public.teams
  for delete to authenticated using (public.is_org_admin(org_id));

drop policy if exists team_members_select_member on public.team_members;
create policy team_members_select_member on public.team_members
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists team_members_insert_admin on public.team_members;
create policy team_members_insert_admin on public.team_members
  for insert to authenticated with check (public.is_org_admin(org_id));

drop policy if exists team_members_delete_admin on public.team_members;
create policy team_members_delete_admin on public.team_members
  for delete to authenticated using (public.is_org_admin(org_id));

-- ---------------------------------------------------------------------------
-- Guard: a person can only be on a team in a studio they belong to
--
-- Without this an admin could add someone from another studio to their team
-- by calling the API directly; RLS only checks that the *admin* is in the org,
-- not that the target person is.
-- ---------------------------------------------------------------------------
create or replace function public.guard_team_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.memberships m
    where m.org_id = new.org_id and m.user_id = new.user_id
  ) then
    raise exception 'That person is not a member of this studio';
  end if;
  if not exists (
    select 1 from public.teams t where t.id = new.team_id and t.org_id = new.org_id
  ) then
    raise exception 'Team and member must belong to the same studio';
  end if;
  return new;
end $$;

drop trigger if exists team_members_guard on public.team_members;
create trigger team_members_guard
  before insert or update on public.team_members
  for each row execute function public.guard_team_member();

-- ---------------------------------------------------------------------------
-- Guard: a task's team must be in the same studio as the task
-- ---------------------------------------------------------------------------
create or replace function public.guard_task_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is not null and not exists (
    select 1 from public.teams t where t.id = new.team_id and t.org_id = new.org_id
  ) then
    raise exception 'That team belongs to a different studio';
  end if;
  return new;
end $$;

drop trigger if exists tasks_team_guard on public.tasks;
create trigger tasks_team_guard
  before insert or update on public.tasks
  for each row execute function public.guard_task_team();

grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
