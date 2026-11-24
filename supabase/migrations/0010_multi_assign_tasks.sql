-- ===========================================================================
-- 0010 · A task can have more than one person on it
--
-- Until now a task had a single `assignee_id`. The client asked to assign one
-- job to several people at once (and to have the task's team follow whoever is
-- assigned), which needs a real join table rather than a text column.
--
-- Design notes
--   • `tasks.assignee_id` stays, and stays meaningful: it is the *lead*, and
--     every RLS policy and the member update guard already reference it. The
--     app writes both, so they can never disagree.
--   • `task_assignees` is the full list (lead included, `position` 0).
--   • Existing tasks are backfilled from `assignee_id`, so nothing has to
--     special-case old rows.
--   • Visibility widens in exactly one way: a task is now visible to everyone
--     on it, not only to the lead. That is the point of sharing a task.
--
-- Idempotent: safe to re-run.
-- ===========================================================================

create table if not exists public.task_assignees (
  task_id  uuid not null references public.tasks(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  org_id   uuid not null references public.organizations(id) on delete cascade,
  position int  not null default 0,
  primary key (task_id, user_id)
);

-- The app's role needs explicit table privileges; RLS then decides which rows.
-- (Policies are not grants: without this, `authenticated` gets 42501.)
grant select, insert, update, delete on public.task_assignees to authenticated;

create index if not exists task_assignees_user_idx on public.task_assignees (user_id);
create index if not exists task_assignees_org_idx  on public.task_assignees (org_id);

-- ---------------------------------------------------------------------------
-- Backfill: every task's lead becomes its first join row.
-- ---------------------------------------------------------------------------
insert into public.task_assignees (task_id, user_id, org_id, position)
select t.id, t.assignee_id, t.org_id, 0
from public.tasks t
where t.assignee_id is not null
on conflict (task_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Guard: everyone on a task must belong to the task's studio
--
-- RLS checks the *caller*; without this an admin could attach a person from
-- another studio by calling the API directly.
-- ---------------------------------------------------------------------------
create or replace function public.guard_task_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.memberships m
    where m.org_id = new.org_id and m.user_id = new.user_id
  ) then
    raise exception 'That person is not a member of this studio';
  end if;
  if not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.org_id = new.org_id
  ) then
    raise exception 'Task and assignee must belong to the same studio';
  end if;
  return new;
end $$;

drop trigger if exists task_assignees_guard on public.task_assignees;
create trigger task_assignees_guard
  before insert or update on public.task_assignees
  for each row execute function public.guard_task_assignee();

-- ---------------------------------------------------------------------------
-- Helper: is auth.uid() on this task?
--
-- A security-definer function keeps the "am I on this task" test out of the
-- policy body, so `tasks_select` stays a single indexed predicate per row.
-- ---------------------------------------------------------------------------
create or replace function public.is_task_assignee(target_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.task_assignees a
    where a.task_id = target_task and a.user_id = auth.uid()
  );
$$;

grant execute on function public.is_task_assignee(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS on the join table
-- ---------------------------------------------------------------------------
alter table public.task_assignees enable row level security;

drop policy if exists task_assignees_select on public.task_assignees;
/*
 * Admins see every roster; a person on the task sees the whole roster too (a
 * shared task's card lists everybody, so hiding the others would make the
 * "shared with" line lie). Everyone else sees only their own row.
 */
create policy task_assignees_select on public.task_assignees
  for select to authenticated
  using (
    public.is_org_admin(org_id)
    or user_id = auth.uid()
    or public.is_task_assignee(task_id)
  );

drop policy if exists task_assignees_insert_admin on public.task_assignees;
create policy task_assignees_insert_admin on public.task_assignees
  for insert to authenticated with check (public.is_org_admin(org_id));

drop policy if exists task_assignees_delete_admin on public.task_assignees;
create policy task_assignees_delete_admin on public.task_assignees
  for delete to authenticated using (public.is_org_admin(org_id));

-- ---------------------------------------------------------------------------
-- Widen task visibility to everyone on the task
-- ---------------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    public.is_org_admin(org_id)
    or assignee_id = auth.uid()
    or public.is_task_assignee(id)
  );

-- A member may update a task they are on, not only the one they lead.
drop policy if exists tasks_update_assignee on public.tasks;
create policy tasks_update_assignee on public.tasks
  for update to authenticated
  using (assignee_id = auth.uid() or public.is_task_assignee(id))
  with check (assignee_id = auth.uid() or public.is_task_assignee(id));

-- ---------------------------------------------------------------------------
-- Member update guard: compare the *whole* set of people, not just the lead
--
-- The old guard let a member change `assignee_id` to themselves while leaving
-- the rest of the row alone. With several assignees the meaningful check is
-- "did the membership of this task change at all?".
-- ---------------------------------------------------------------------------
create or replace function public.guard_task_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_org_admin(old.org_id) then return new; end if;
  if old.assignee_id is distinct from auth.uid() and not public.is_task_assignee(old.id) then
    raise exception 'You can only update tasks assigned to you';
  end if;
  if (new.title, new.client, new.description, new.assignee_id, new.est_hours,
      new.priority, new.deadline, new.team_id, new.start_date, new.due_time, new.org_id) is distinct from
     (old.title, old.client, old.description, old.assignee_id, old.est_hours,
      old.priority, old.deadline, old.team_id, old.start_date, old.due_time, old.org_id) then
    raise exception 'Members can only update progress and status';
  end if;
  return new;
end $$;

drop trigger if exists tasks_guard_update on public.tasks;
create trigger tasks_guard_update
  before update on public.tasks
  for each row execute function public.guard_task_update();

-- ---------------------------------------------------------------------------
-- Free plan: 10 seats for now
--
-- Plans and payment come later; the free tier should not be what stops a
-- studio from trying the product with its whole crew. This only touches
-- organisations that are still on the default 5, so a studio that has already
-- been set up differently keeps its limit.
-- ---------------------------------------------------------------------------
alter table public.organizations alter column seat_limit set default 10;

update public.organizations
set seat_limit = 10
where plan = 'free' and seat_limit = 5;

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
  values (trim(org_name), final_slug, 'free', 10, auth.uid())
  returning id into new_org;

  insert into public.memberships (org_id, user_id, role, capacity)
  values (new_org, auth.uid(), 'owner', 40);

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id)
  values (new_org, auth.uid(), 'org.created', 'organization', new_org::text);

  return new_org;
end $$;

-- ---------------------------------------------------------------------------
-- Task lists filter by (org, status) on every page load. (org, team) is already
-- indexed by 0005 as `tasks_org_team_idx`, so it is not repeated here.
-- ---------------------------------------------------------------------------
create index if not exists tasks_org_status_idx on public.tasks (org_id, status);
