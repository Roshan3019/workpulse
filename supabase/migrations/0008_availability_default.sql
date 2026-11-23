-- ============================================================================
-- 0008_availability_default.sql — a default week that fills itself in
--
-- The client's request: freelancers should not have to re-select their hours
-- every week. They set a usual week once, and future weeks inherit it.
--
-- The rule, exactly as agreed:
--   • `default_states` is a *template*, one entry per weekday (0=Sun … 6=Sat).
--   • A week is never written ahead of time. When a day is read and it has no
--     row of its own, the template for that weekday is what the UI shows.
--   • The moment the person edits a day, that day gets its own row and its own
--     `states` — and that copy wins over the template from then on.
--   • Turning the template off deletes the template only. Days already copied
--     stay put, so nobody loses work by flipping a switch.
--
-- Why a read-time fallback rather than a cron that inserts rows
-- ---------------------------------------------------------------------------
-- Materialising future weeks would need a scheduled job, would duplicate data
-- for every member every week, and would make "I changed my mind about
-- Thursdays" a bulk update. A fallback is a single function call at read time,
-- always reflects the latest template, and has no state to drift.
-- ============================================================================

alter table public.availability
  add column if not exists default_states jsonb;

comment on column public.availability.default_states is
  'Weekly template: {"0".."6": {"9":"free","10":"busy"}}. Null means no default set. Stored on the member''s earliest availability row.';

-- Template rows carry no date of their own; this partial unique index makes
-- "one template per person per studio" enforceable while leaving the dated
-- rows untouched. A template row is identified by slot_date being NULL.
alter table public.availability alter column slot_date drop not null;

create unique index if not exists availability_default_unique
  on public.availability (org_id, user_id)
  where slot_date is null;

-- The legacy `hours` mirror only makes sense for dated rows.
create or replace function public.sync_availability_hours()
returns trigger language plpgsql as $$
begin
  if new.slot_date is null then
    new.hours := '{}'::int[];
    return new;
  end if;
  new.hours := coalesce(
    (
      select array_agg(k::int order by k::int)
      from jsonb_each_text(new.states) as e(k, v)
      where v = 'free'
    ),
    '{}'::int[]
  );
  return new;
end $$;

-- Validate the template the same way as the dated states, but allow it to be
-- null (meaning "no default") and never let a dated row carry one.
create or replace function public.validate_availability_states()
returns trigger language plpgsql as $$
declare
  bad_key text;
  bad_val text;
begin
  if new.slot_date is not null and new.default_states is not null then
    raise exception 'A dated availability row cannot also be a weekly template';
  end if;

  -- Dated rows: hour -> state.
  select e.key, e.value into bad_key, bad_val
  from jsonb_each_text(coalesce(new.states, '{}'::jsonb)) as e(key, value)
  where e.value not in ('free', 'busy')
     or e.key !~ '^([0-9]|1[0-9]|2[0-3])$'
  limit 1;

  if bad_key is not null then
    raise exception 'Invalid availability state at hour "%": %', bad_key, bad_val;
  end if;

  -- Templates: weekday -> { hour -> state }. Validate the inner map too, since
  -- set_weekly_default is not the only way a row can be written.
  if new.default_states is not null then
    if jsonb_typeof(new.default_states) <> 'object' then
      raise exception 'Weekly default must be an object keyed by weekday';
    end if;
    select d.key, e.key into bad_key, bad_val
      from jsonb_each(new.default_states) as d(key, value)
      cross join lateral jsonb_each_text(
        case when jsonb_typeof(d.value) = 'object' then d.value else '{}'::jsonb end
      ) as e(key, value)
     where d.key !~ '^[0-6]$'
        or e.value not in ('free', 'busy')
        or e.key !~ '^([0-9]|1[0-9]|2[0-3])$'
     limit 1;

    if bad_key is not null then
      raise exception 'Invalid weekly default at weekday "%": %', bad_key, bad_val;
    end if;

    if exists (
      select 1 from jsonb_each(new.default_states) as d(key, value)
       where jsonb_typeof(d.value) <> 'object'
    ) then
      raise exception 'Each weekday in the weekly default must map hours to free or busy';
    end if;
  end if;

  return new;
end $$;

-- Belt and braces: hold the trigger from firing before the column exists on a
-- re-run (0006 already created it, so this is only a `create or replace`).
drop trigger if exists availability_sync_hours on public.availability;
create trigger availability_sync_hours
  before insert or update of states on public.availability
  for each row execute function public.sync_availability_hours();

-- ---------------------------------------------------------------------------
-- The template itself, validated per weekday
-- ---------------------------------------------------------------------------
create or replace function public.set_weekly_default(target_states jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid;
  key text;
  day jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select m.org_id into org
    from public.memberships m
   where m.user_id = auth.uid() and m.role = 'member'
   limit 1;
  if org is null then
    raise exception 'Availability is only tracked for members';
  end if;

  if target_states is not null then
    if jsonb_typeof(target_states) <> 'object' then
      raise exception 'Weekly default must be an object keyed by weekday';
    end if;
    for key, day in select * from jsonb_each(target_states) loop
      if key !~ '^[0-6]$' then
        raise exception 'Invalid weekday "%"', key;
      end if;
      if jsonb_typeof(day) <> 'object' then
        raise exception 'Weekday "%" must map hours to free or busy', key;
      end if;
      if exists (
        select 1 from jsonb_each_text(day) as e(k, v)
         where v not in ('free', 'busy') or e.k !~ '^([0-9]|1[0-9]|2[0-3])$'
      ) then
        raise exception 'Weekday "%" has an invalid hour or state', key;
      end if;
    end loop;
  end if;

  insert into public.availability (org_id, user_id, slot_date, states, default_states)
  values (org, auth.uid(), null, '{}'::jsonb, target_states)
  on conflict (org_id, user_id) where slot_date is null
  do update set default_states = excluded.default_states, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- clear_weekly_default — removes the template, keeps every dated day
-- ---------------------------------------------------------------------------
create or replace function public.clear_weekly_default()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from public.availability
   where user_id = auth.uid()
     and slot_date is null;
end $$;

-- ---------------------------------------------------------------------------
-- get_weekly_default — the member's template (or null)
-- ---------------------------------------------------------------------------
create or replace function public.get_weekly_default()
returns jsonb language sql stable security definer set search_path = public as $$
  select a.default_states
    from public.availability a
   where a.user_id = auth.uid()
     and a.slot_date is null
   limit 1;
$$;

grant execute on function public.set_weekly_default(jsonb) to authenticated;
grant execute on function public.clear_weekly_default() to authenticated;
grant execute on function public.get_weekly_default() to authenticated;

-- ---------------------------------------------------------------------------
-- Resolving a week
--
-- One function answers "what does this person's week look like", applying the
-- template only where no dated row exists. The app calls this instead of
-- splicing two result sets together, so the precedence rule lives in exactly
-- one place — the same place that owns the data.
-- ---------------------------------------------------------------------------
create or replace function public.availability_week(target_org uuid, target_user uuid, from_date date, to_date date)
returns table (slot_date date, states jsonb, from_default boolean)
language sql stable security definer set search_path = public as $$
  with days as (
    select generate_series(from_date, to_date, interval '1 day')::date as d
  ),
  template as (
    select a.default_states as t
      from public.availability a
     where a.org_id = target_org
       and a.user_id = target_user
       and a.slot_date is null
     limit 1
  ),
  own_rows as (
    select a.slot_date as d, a.states as s
      from public.availability a
     where a.org_id = target_org
       and a.user_id = target_user
       and a.slot_date between from_date and to_date
  )
  select days.d,
         coalesce(own_rows.s, template.t -> extract(dow from days.d)::int::text) as states,
         own_rows.s is null and (template.t -> extract(dow from days.d)::int::text) is not null as from_default
    from days
    left join own_rows on own_rows.d = days.d
    left join template on true
   where public.is_org_member(target_org)
   order by days.d;
$$;

grant execute on function public.availability_week(uuid, uuid, date, date) to authenticated;
