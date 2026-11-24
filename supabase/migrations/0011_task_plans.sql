-- ============================================================================
-- 0011_task_plans.sql — a member plans the hours they'll work on a task
-- ============================================================================
--
-- The client's request: an admin assigns a task, the member picks the hours
-- they will work on it, and the admin sees one continuous busy block with the
-- task name on that person's row in the team-slot card.
--
-- One row = one block
-- -------------------
-- `start_hour` is inclusive and `end_hour` exclusive, so 14 → 18 is "2pm to
-- 6pm". Keeping a block as one row (rather than twelve hour rows) is what makes
-- "one long block, not eight squares" true in the data, not just in the CSS:
-- the grid has nothing to stitch back together.
--
-- `minutes` is the effort inside the block. A 4-hour block can hold 2 hours of
-- a small job; the workload figures add `minutes`, not the block length, so
-- planning generously never inflates somebody's load.
--
-- Visibility
-- ----------
-- The member owns their plans; admins in the same studio read them to build the
-- team view. Nobody else sees them, and a member can only plan hours on a task
-- they are actually on (`is_task_assignee`, added in 0010).
--
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

create table if not exists public.task_plans (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  plan_date  date not null,
  start_hour int  not null,
  end_hour   int  not null,
  minutes    int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_plans_window check (start_hour >= 0 and end_hour <= 24 and end_hour > start_hour),
  constraint task_plans_minutes check (minutes >= 0 and minutes <= (end_hour - start_hour) * 60)
);

-- Policies are not grants: without this `authenticated` gets 42501.
grant select, insert, update, delete on public.task_plans to authenticated;

comment on table public.task_plans is
  'Hours a member has set aside to work on a task. One row per continuous block; end_hour is exclusive.';

create index if not exists task_plans_day_idx  on public.task_plans (org_id, plan_date);
create index if not exists task_plans_user_idx on public.task_plans (org_id, user_id, plan_date);
create index if not exists task_plans_task_idx on public.task_plans (task_id);

/* ---------------------------------------------------------------------------- */
/* Guard: the block must belong to someone who is actually on the task          */
/* ---------------------------------------------------------------------------- */
-- Same shape as 0010's assignee guards: a security-definer helper so the check
-- does not depend on the caller being able to read `task_assignees`.
create or replace function public.guard_task_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /*
   * This function is security definer because it reads `task_assignees`, which
   * RLS hides from most callers — without that, a legitimate plan by the second
   * person on a shared task would look like an intruder to the check itself.
   * Everything it reads stays local: no `auth.uid()` is consulted here, so the
   * definer execution cannot be borrowed to see another studio's data.
   */
  if not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.org_id = new.org_id
  ) then
    raise exception 'That task is not in this studio';
  end if;

  if not (
    exists (select 1 from public.tasks t where t.id = new.task_id and t.assignee_id = new.user_id)
    or exists (
      select 1 from public.task_assignees a
       where a.task_id = new.task_id and a.user_id = new.user_id
    )
  ) then
    raise exception 'Only someone on the task can plan hours for it';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists guard_task_plan on public.task_plans;
create trigger guard_task_plan
  before insert or update on public.task_plans
  for each row execute function public.guard_task_plan();

/* ---------------------------------------------------------------------------- */
/* Row-level security                                                           */
/* ---------------------------------------------------------------------------- */
alter table public.task_plans enable row level security;

drop policy if exists task_plans_select on public.task_plans;
create policy task_plans_select on public.task_plans
  for select using (
    user_id = auth.uid()
    or public.is_org_admin(org_id)
  );

drop policy if exists task_plans_insert on public.task_plans;
create policy task_plans_insert on public.task_plans
  for insert with check (
    user_id = auth.uid()
    and public.is_org_member(org_id)
  );

drop policy if exists task_plans_update on public.task_plans;
create policy task_plans_update on public.task_plans
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists task_plans_delete on public.task_plans;
create policy task_plans_delete on public.task_plans
  for delete using (user_id = auth.uid());

/* ---------------------------------------------------------------------------- */
/* Backfill: a task that names its start day gets a first block waiting          */
/* ---------------------------------------------------------------------------- */
-- Rounds of experience with this repo have shown the app is happier when the
-- member finds a block to adjust than an empty grid. `minutes` starts at 0
-- ("you haven't told me how much of the block is the work") rather than the
-- estimate, so nothing claims time the member never agreed to.
insert into public.task_plans (org_id, task_id, user_id, plan_date, start_hour, end_hour, minutes)
select t.org_id,
       t.id,
       assignee.uid,
       t.start_date,
       9,
       least(24, 9 + greatest(1, ceil(coalesce(t.est_hours, 1))::int)),
       0
  from public.tasks t
  cross join lateral (
    select coalesce(
             (select a.user_id from public.task_assignees a
               where a.task_id = t.id
               order by a.position asc nulls last
               limit 1),
             t.assignee_id
           ) as uid
  ) as assignee
 where t.start_date is not null
   and assignee.uid is not null
   and not exists (select 1 from public.task_plans p where p.task_id = t.id and p.user_id = assignee.uid);

/* ---------------------------------------------------------------------------- */
/* RPC: set_task_plan — replace one task's blocks for one day, atomically       */
/* ---------------------------------------------------------------------------- */
-- The client-facing editor sends the blocks it wants for a day. Replacing the
-- day's blocks for that task in one call means a drag that split a block, or
-- merged two, cannot leave a stale half behind.
create or replace function public.set_task_plan(
  target_task uuid,
  plan_date   date,
  blocks      jsonb
)
returns int language plpgsql security definer set search_path = public as $$
declare
  org uuid;
  entry jsonb;
  written int := 0;
  start_h int;
  end_h   int;
  mins    int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select t.org_id into org from public.tasks t where t.id = target_task;
  if org is null then raise exception 'Task not found'; end if;

  if not public.is_task_assignee(target_task) then
    raise exception 'Only someone on the task can plan hours for it';
  end if;

  /*
   * Delete as the function owner. `task_plans_delete` already limits a member to
   * their own rows, but running it as the definer means the delete does not
   * depend on the caller being able to *read* rows they are about to remove.
   */
  delete from public.task_plans p
   where p.task_id = target_task
     and p.user_id = auth.uid()
     and p.plan_date = set_task_plan.plan_date;

  for entry in select * from jsonb_array_elements(coalesce(blocks, '[]'::jsonb)) loop
    start_h := coalesce((entry->>'startHour')::int, 0);
    end_h   := coalesce((entry->>'endHour')::int, 0);
    mins    := coalesce((entry->>'minutes')::int, 0);

    if end_h <= start_h then continue; end if;

    insert into public.task_plans (org_id, task_id, user_id, plan_date, start_hour, end_hour, minutes)
    values (org, target_task, auth.uid(), set_task_plan.plan_date, start_h, end_h, mins);
    written := written + 1;
  end loop;

  -- Planning hours is saying "I'm busy then": make that visible on the calendar
  -- too, so the team view and the member's own page cannot disagree.
  insert into public.availability (org_id, user_id, slot_date, states)
  select org, auth.uid(), set_task_plan.plan_date,
         coalesce((
           select jsonb_object_agg(h::text, 'busy'::text)
             from public.task_plans p,
                  lateral generate_series(p.start_hour, p.end_hour - 1) as h
            where p.task_id = target_task
              and p.user_id = auth.uid()
              and p.plan_date = set_task_plan.plan_date
         ), '{}'::jsonb)
  where written > 0
  on conflict (org_id, user_id, slot_date) do update
    set states = public.availability.states || excluded.states,
        updated_at = now();

  return written;
end $$;

grant execute on function public.set_task_plan(uuid, date, jsonb) to authenticated;

/* ---------------------------------------------------------------------------- */
/* RPC: clear_task_plan — forget this task's blocks on a day                    */
/* ---------------------------------------------------------------------------- */
create or replace function public.clear_task_plan(target_task uuid, plan_date date)
returns int language plpgsql security definer set search_path = public as $$
declare
  removed int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from public.task_plans p
   where p.task_id = target_task
     and p.user_id = auth.uid()
     and p.plan_date = clear_task_plan.plan_date;
  get diagnostics removed = row_count;
  return removed;
end $$;

grant execute on function public.clear_task_plan(uuid, date) to authenticated;

/* ---------------------------------------------------------------------------- */
/* Housekeeping: when a plan goes, put the hours it claimed back                */
/* ---------------------------------------------------------------------------- */
-- Deleting a plan used to leave its hours marked busy forever: the member
-- cleared "Landing page" from 2–6pm and their calendar still said busy, with
-- nothing left to explain it. This trigger only touches hours that are busy and
-- covered by *no remaining plan*, so an hour the member marked busy by hand, or
-- one another task still needs, is left exactly as it was.
create or replace function public.release_plan_hours()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  keep    jsonb := '[]'::jsonb;   -- hours another plan still covers
  release jsonb := '[]'::jsonb;   -- this plan's hours minus those
  hour    int;
begin
  /*
   * Two steps, both plain jsonb, so there is no array/text casting to get wrong
   * (that was a real bug: `::text[]` on a jsonb_agg is not a cast Postgres
   * accepts). `keep` is every hour of this person's that another plan covers on
   * that day; `release` is this block's hours that are not in it.
   */
  select coalesce(jsonb_agg(distinct to_jsonb(h)), '[]'::jsonb)
    into keep
    from public.task_plans p,
         lateral generate_series(p.start_hour, p.end_hour - 1) as h
   where p.org_id = old.org_id
     and p.user_id = old.user_id
     and p.plan_date = old.plan_date;

  select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
    into release
    from generate_series(old.start_hour, old.end_hour - 1) as h
   where not keep @> to_jsonb(h);

  -- Put those hours back to "not filled in", but only where the member is
  -- currently marked busy, so anything they set by hand stays untouched.
  for hour in select (jsonb_array_elements(release))::text::int loop
    update public.availability a
       set states = coalesce(a.states, '{}'::jsonb) - to_jsonb(hour)::text,
           updated_at = now()
     where a.org_id = old.org_id
       and a.user_id = old.user_id
       and a.slot_date = old.plan_date
       and coalesce(a.states, '{}'::jsonb) ->> (hour::text) = 'busy';
  end loop;

  return old;
end $$;

drop trigger if exists release_plan_hours on public.task_plans;
create trigger release_plan_hours
  after delete on public.task_plans
  for each row execute function public.release_plan_hours();
