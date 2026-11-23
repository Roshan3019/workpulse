-- ============================================================================
-- 0006_availability_states.sql — free / busy / unassigned
--
-- Availability used to be `hours int[]`: an hour was in the array (free) or
-- not (busy). Two states. The client wants three, so the freelancer can
-- explicitly say "I'm busy" instead of leaving it blank, and so the admin can
-- tell "busy" apart from "hasn't filled this in yet".
--
-- New column `states jsonb` maps hour -> 'free' | 'busy'. An hour with no key
-- is *unassigned* (grey) — so the tri-state falls out of the shape itself and
-- we never need a third sentinel value. `{}` means "nothing set at all".
--
-- MIGRATION SAFETY
-- `hours` is read by 11 files, including the workload calculation and the
-- memory store. Dropping it in the same deploy would break every page that
-- still reads it. So: `hours` stays for now, is kept backfilled from
-- `states` by a trigger, and gets removed later once nothing reads it.
--
--   states  = source of truth for new writes
--   hours   = derived mirror (free hours only) for code that has not moved yet
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add the new column
-- ---------------------------------------------------------------------------
alter table public.availability
  add column if not exists states jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Backfill existing rows: hours present => free
--
-- Guarded by `states = '{}'` so re-running this file never overwrites a row
-- that has since been saved through the new editor.
-- ---------------------------------------------------------------------------
update public.availability a
   set states = coalesce(
     (select jsonb_object_agg(h::text, 'free'::text) from unnest(a.hours) as h),
     '{}'::jsonb
   )
 where a.states = '{}'::jsonb
   and a.hours is not null
   and coalesce(array_length(a.hours, 1), 0) > 0;

-- ---------------------------------------------------------------------------
-- 3. Keep the legacy mirror in sync
--
-- Any write to `states` (from the new code) recomputes `hours`. This means a
-- page still reading `hours` shows current data instead of going stale, which
-- is what allows the cutover to be gradual.
-- ---------------------------------------------------------------------------
create or replace function public.sync_availability_hours()
returns trigger language plpgsql as $$
begin
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

drop trigger if exists availability_sync_hours on public.availability;
create trigger availability_sync_hours
  before insert or update of states on public.availability
  for each row execute function public.sync_availability_hours();

-- ---------------------------------------------------------------------------
-- 4. Validate what goes in
--
-- Cheap guard against a malformed payload from the client. Rejects unknown
-- state values and out-of-range hours rather than storing garbage that the
-- grid would then have to defend against.
-- ---------------------------------------------------------------------------
create or replace function public.validate_availability_states()
returns trigger language plpgsql as $$
declare
  bad_key text;
  bad_val text;
begin
  select e.key, e.value into bad_key, bad_val
  from jsonb_each_text(new.states) as e(key, value)
  where e.value not in ('free', 'busy')
     or e.key !~ '^([0-9]|1[0-9]|2[0-3])$'
  limit 1;

  if bad_key is not null then
    raise exception 'Invalid availability state at hour "%": %', bad_key, bad_val;
  end if;
  return new;
end $$;

drop trigger if exists availability_validate on public.availability;
create trigger availability_validate
  before insert or update on public.availability
  for each row execute function public.validate_availability_states();
