-- ============================================================================
-- WorkPulse — Multi-tenant SaaS schema
-- Supabase / PostgreSQL 15+
--
-- Fresh install: this file is the complete, pgcrypto-free schema — run it alone.
-- Existing projects created before the invite-token fix: also run
--   supabase/migrations/0002_fix_invite_token.sql
-- Never run both on a brand-new project (0001 already contains the fix).
--
-- Security model
--  * Every business row carries org_id. RLS scopes all reads/writes to orgs
--    the caller is a member of.
--  * Roles: owner > admin > member. Nobody can change their own role (trigger).
--  * Only role='member' may hold availability rows (admins do not set
--    availability). Admins can READ any member's availability in their org.
--  * Members may only move progress/status on their own tasks.
-- ============================================================================

-- NOTE: no extensions required. Token generation uses gen_random_uuid()
-- (core since PostgreSQL 13) instead of pgcrypto's gen_random_bytes()/encode(),
-- which live in the `extensions` schema on Supabase and are invisible when a
-- function runs with `set search_path = public` (see 0002_fix_invite_token.sql).

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.org_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum ('pending', 'in_progress', 'done');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.plan_tier as enum ('free', 'pro', 'business');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- PROFILES  (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_email_key on public.profiles (lower(email));

-- ---------------------------------------------------------------------------
-- ORGANIZATIONS  (one per customer/company)
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 2 and 80),
  slug        text not null unique,
  plan        public.plan_tier not null default 'free',
  seat_limit  int not null default 5 check (seat_limit > 0),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- MEMBERSHIPS  (user ↔ org with a role + weekly capacity)
-- ---------------------------------------------------------------------------
create table if not exists public.memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       public.org_role not null default 'member',
  capacity   int not null default 40 check (capacity between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists memberships_org_idx  on public.memberships (org_id);
create index if not exists memberships_user_idx on public.memberships (user_id);

-- ---------------------------------------------------------------------------
-- INVITES
-- ---------------------------------------------------------------------------
create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text,                                  -- null => shareable link
  role        public.org_role not null default 'member',
  token       text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  invited_by  uuid references public.profiles(id) on delete set null,
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists invites_org_idx on public.invites (org_id);

-- ---------------------------------------------------------------------------
-- TASKS
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  title        text not null check (char_length(trim(title)) between 1 and 160),
  client       text not null default '' check (char_length(client) <= 120),
  description  text check (char_length(description) <= 4000),
  assignee_id  uuid references public.profiles(id) on delete set null,
  est_hours    numeric(6,2) not null default 1 check (est_hours > 0 and est_hours <= 500),
  progress     int not null default 0 check (progress between 0 and 100),
  status       public.task_status not null default 'pending',
  priority     public.task_priority not null default 'medium',
  deadline     date,
  start_date   date,      -- optional: when work starts
  due_time     time,      -- optional: exact due time
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_org_idx      on public.tasks (org_id);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);
create index if not exists tasks_status_idx   on public.tasks (org_id, status);

-- ---------------------------------------------------------------------------
-- AVAILABILITY  (one row per member per calendar date)
-- ---------------------------------------------------------------------------
create table if not exists public.availability (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  slot_date  date not null,
  hours      int[] not null default '{}'::int[],
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, slot_date)
);
create index if not exists availability_org_date_idx on public.availability (org_id, slot_date);

-- ---------------------------------------------------------------------------
-- AUDIT LOG (who changed what — useful when you sell to companies)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigserial primary key,
  org_id     uuid references public.organizations(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  entity     text,
  entity_id  text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_org_idx on public.audit_log (org_id, created_at desc);

-- ===========================================================================
-- HELPER FUNCTIONS
-- ===========================================================================
create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.role_in_org(target_org uuid)
returns public.org_role language sql stable security definer set search_path = public as $$
  select m.role from public.memberships m
  where m.org_id = target_org and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_org_admin(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.role_in_org(target_org) in ('owner','admin'), false);
$$;

create or replace function public.org_seat_count(target_org uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.memberships where org_id = target_org;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: create profile on signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        updated_at = now();
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Guard: nobody changes their own role; admins cannot demote/alter the owner
-- ---------------------------------------------------------------------------
create or replace function public.guard_membership_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_role public.org_role := public.role_in_org(old.org_id);
begin
  if new.role is distinct from old.role then
    if old.user_id = auth.uid() then
      raise exception 'You cannot change your own role';
    end if;
    if actor_role = 'admin' and old.role = 'owner' then
      raise exception 'Only the owner can change the owner''s role';
    end if;
    if actor_role not in ('owner','admin') then
      raise exception 'Not allowed';
    end if;
  end if;
  if new.org_id is distinct from old.org_id then
    raise exception 'Membership cannot be moved between organizations';
  end if;
  return new;
end $$;

drop trigger if exists memberships_guard_update on public.memberships;
create trigger memberships_guard_update
  before update on public.memberships
  for each row execute function public.guard_membership_update();

-- ---------------------------------------------------------------------------
-- Guard: last owner cannot be removed (keeps every org admin-able)
-- ---------------------------------------------------------------------------
create or replace function public.guard_last_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role is distinct from 'owner') then
    if (select count(*) from public.memberships
        where org_id = old.org_id and role = 'owner'
          and id <> old.id) = 0 then
      raise exception 'An organization must keep at least one owner';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists memberships_last_owner on public.memberships;
create trigger memberships_last_owner
  before update or delete on public.memberships
  for each row execute function public.guard_last_owner();

-- ---------------------------------------------------------------------------
-- Guard: availability only for members (admins/owners do not set availability)
-- ---------------------------------------------------------------------------
create or replace function public.guard_availability_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.org_role;
begin
  select role into r from public.memberships
  where org_id = new.org_id and user_id = new.user_id;
  if r is null then raise exception 'Not a member of this organization'; end if;
  if r <> 'member' then
    raise exception 'Availability is only tracked for members, not %s', r;
  end if;
  if auth.uid() is not null and new.user_id <> auth.uid() then
    raise exception 'You can only edit your own availability';
  end if;
  if new.hours is not null and exists (
    select 1 from unnest(new.hours) h where h < 0 or h > 23
  ) then
    raise exception 'Invalid hour value';
  end if;
  return new;
end $$;

drop trigger if exists availability_guard on public.availability;
create trigger availability_guard
  before insert or update on public.availability
  for each row execute function public.guard_availability_role();

-- ---------------------------------------------------------------------------
-- Guard: members may only move progress/status on their own tasks
-- ---------------------------------------------------------------------------
create or replace function public.guard_task_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_org_admin(old.org_id) then return new; end if;
  if old.assignee_id is distinct from auth.uid() then
    raise exception 'You can only update tasks assigned to you';
  end if;
  if (new.title, new.client, new.description, new.assignee_id, new.est_hours,
      new.priority, new.deadline, new.org_id) is distinct from
     (old.title, old.client, old.description, old.assignee_id, old.est_hours,
      old.priority, old.deadline, old.org_id) then
    raise exception 'Members can only update progress and status';
  end if;
  return new;
end $$;

drop trigger if exists tasks_guard_update on public.tasks;
create trigger tasks_guard_update
  before update on public.tasks
  for each row execute function public.guard_task_update();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','organizations','memberships','tasks','availability'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ===========================================================================
-- RPC: create_organization  (called right after signup)
-- ===========================================================================
create or replace function public.create_organization(org_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_org uuid;
  base_slug text;
  final_slug text;
  n int := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if char_length(trim(org_name)) < 2 then raise exception 'Organization name too short'; end if;

  base_slug := trim(both '-' from regexp_replace(lower(trim(org_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'team'; end if;
  final_slug := base_slug;
  while exists (select 1 from public.organizations o where o.slug = final_slug) loop
    n := n + 1;
    final_slug := base_slug || '-' || n::text;
  end loop;

  insert into public.organizations (name, slug, plan, seat_limit, created_by)
  values (trim(org_name), final_slug, 'free', 5, auth.uid())
  returning id into new_org;

  insert into public.memberships (org_id, user_id, role, capacity)
  values (new_org, auth.uid(), 'owner', 40);

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id)
  values (new_org, auth.uid(), 'org.created', 'organization', new_org::text);

  return new_org;
end $$;

-- ===========================================================================
-- RPC: create_invite  (admin+ only, enforces seat limit)
-- ===========================================================================
create or replace function public.create_invite(target_org uuid, invite_email text, invite_role public.org_role)
returns text language plpgsql security definer set search_path = public as $$
declare
  tok text;
  lim int;
begin
  if not public.is_org_admin(target_org) then raise exception 'Not allowed'; end if;
  if invite_role = 'owner' then raise exception 'Owner role cannot be granted by invite'; end if;

  select seat_limit into lim from public.organizations where id = target_org;
  if public.org_seat_count(target_org) >= lim then
    raise exception 'Seat limit reached for your plan (%). Upgrade to invite more people.', lim;
  end if;

  insert into public.invites (org_id, email, role, invited_by, token)
  values (
    target_org,
    nullif(lower(trim(coalesce(invite_email,''))), ''),
    invite_role,
    auth.uid(),
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  )
  returning token into tok;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, meta)
  values (target_org, auth.uid(), 'invite.created', 'invites', tok, jsonb_build_object('email', invite_email, 'role', invite_role));

  return tok;
end $$;

-- ===========================================================================
-- RPC: accept_invite  (called by the signed-in invitee)
-- ===========================================================================
create or replace function public.accept_invite(invite_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv record;
  caller_email text;
  existing uuid;
  lim int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select lower(email) into caller_email from public.profiles where id = auth.uid();

  select * into inv from public.invites where token = invite_token for update;
  if inv is null then raise exception 'Invite not found'; end if;
  if inv.accepted_at is not null then raise exception 'This invite was already used'; end if;
  if inv.expires_at < now() then raise exception 'This invite has expired'; end if;
  if inv.email is not null and inv.email <> caller_email then
    raise exception 'This invite was issued to a different email address';
  end if;

  select id into existing from public.memberships
   where org_id = inv.org_id and user_id = auth.uid();
  if existing is not null then
    update public.invites set accepted_at = now() where id = inv.id;
    return inv.org_id;  -- already a member, idempotent
  end if;

  select seat_limit into lim from public.organizations where id = inv.org_id;
  if public.org_seat_count(inv.org_id) >= lim then
    raise exception 'This team has reached its seat limit. Ask an admin to upgrade the plan.';
  end if;

  insert into public.memberships (org_id, user_id, role, capacity)
  values (inv.org_id, auth.uid(), inv.role, 40);

  update public.invites set accepted_at = now() where id = inv.id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id)
  values (inv.org_id, auth.uid(), 'invite.accepted', 'memberships', auth.uid()::text);

  return inv.org_id;
end $$;

-- ===========================================================================
-- RPC: transfer_ownership  (owner hands the keys to another admin/member)
-- ===========================================================================
create or replace function public.transfer_ownership(target_org uuid, new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.role_in_org(target_org) <> 'owner' then raise exception 'Only the owner can transfer ownership'; end if;
  if new_owner = auth.uid() then raise exception 'You are already the owner'; end if;
  if not exists (select 1 from public.memberships where org_id = target_org and user_id = new_owner) then
    raise exception 'Target user is not a member of this organization';
  end if;

  update public.memberships set role = 'admin' where org_id = target_org and user_id = auth.uid();
  update public.memberships set role = 'owner' where org_id = target_org and user_id = new_owner;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, meta)
  values (target_org, auth.uid(), 'org.ownership_transferred', 'memberships', new_owner::text, '{}'::jsonb);
end $$;

-- ===========================================================================
-- ROW LEVEL SECURITY
-- ===========================================================================
alter table public.profiles      enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.invites        enable row level security;
alter table public.tasks         enable row level security;
alter table public.availability  enable row level security;
alter table public.audit_log     enable row level security;

-- PROFILES -----------------------------------------------------------------
drop policy if exists profiles_select_self_or_teammate on public.profiles;
create policy profiles_select_self_or_teammate on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.memberships me
      join public.memberships them on them.org_id = me.org_id
      where me.user_id = auth.uid() and them.user_id = profiles.id
    )
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ORGANIZATIONS ------------------------------------------------------------
drop policy if exists orgs_select_member on public.organizations;
create policy orgs_select_member on public.organizations
  for select to authenticated using (public.is_org_member(id));

drop policy if exists orgs_update_admin on public.organizations;
create policy orgs_update_admin on public.organizations
  for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));

-- MEMBERSHIPS --------------------------------------------------------------
drop policy if exists memberships_select_org on public.memberships;
create policy memberships_select_org on public.memberships
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists memberships_update_admin on public.memberships;
create policy memberships_update_admin on public.memberships
  for update to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop policy if exists memberships_delete_admin on public.memberships;
create policy memberships_delete_admin on public.memberships
  for delete to authenticated
  using (public.is_org_admin(org_id) and user_id <> auth.uid());

-- INVITES ------------------------------------------------------------------
drop policy if exists invites_select_admin on public.invites;
create policy invites_select_admin on public.invites
  for select to authenticated using (public.is_org_admin(org_id));

drop policy if exists invites_delete_admin on public.invites;
create policy invites_delete_admin on public.invites
  for delete to authenticated using (public.is_org_admin(org_id));

-- TASKS --------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    public.is_org_admin(org_id) or assignee_id = auth.uid()
  );

drop policy if exists tasks_insert_admin on public.tasks;
create policy tasks_insert_admin on public.tasks
  for insert to authenticated with check (public.is_org_admin(org_id));

drop policy if exists tasks_update_admin on public.tasks;
create policy tasks_update_admin on public.tasks
  for update to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists tasks_update_assignee on public.tasks;
create policy tasks_update_assignee on public.tasks
  for update to authenticated using (assignee_id = auth.uid()) with check (assignee_id = auth.uid());

drop policy if exists tasks_delete_admin on public.tasks;
create policy tasks_delete_admin on public.tasks
  for delete to authenticated using (public.is_org_admin(org_id));

-- AVAILABILITY -------------------------------------------------------------
drop policy if exists availability_select on public.availability;
create policy availability_select on public.availability
  for select to authenticated
  using (public.is_org_admin(org_id) or user_id = auth.uid());

drop policy if exists availability_write_own on public.availability;
create policy availability_write_own on public.availability
  for insert to authenticated with check (user_id = auth.uid() and public.is_org_member(org_id));

drop policy if exists availability_update_own on public.availability;
create policy availability_update_own on public.availability
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists availability_delete_own on public.availability;
create policy availability_delete_own on public.availability
  for delete to authenticated using (user_id = auth.uid());

-- AUDIT LOG ----------------------------------------------------------------
drop policy if exists audit_select_admin on public.audit_log;
create policy audit_select_admin on public.audit_log
  for select to authenticated using (org_id is not null and public.is_org_admin(org_id));

-- ===========================================================================
-- GRANTS (Supabase roles)
-- ===========================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.audit_log from anon;
