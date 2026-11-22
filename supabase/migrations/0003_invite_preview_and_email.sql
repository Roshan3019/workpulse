-- ============================================================================
-- WorkPulse — Invite links that work for people without an account
--
-- Run this in the Supabase SQL Editor after 0001 and 0002. Idempotent.
--
-- Why this migration exists
-- ------------------------
-- 1) An invite link has to work for a brand-new visitor. The invite page needs
--    to say "you're joining Acme" BEFORE the person has signed up, but
--    `public.invites` is RLS-protected for admins only (0001). Reading it as
--    `anon` therefore returned nothing and the page tried to load an
--    organization with an empty id:
--        load organization: invalid input syntax for type uuid: ""
--    `invite_preview()` is a security-definer function that exposes only the
--    three things the page may show (team name, role, invited email). The
--    token itself is the secret — anyone holding it is already allowed to see
--    this much.
--
-- 2) Emailing the invite. Supabase Auth can send the invite email for us via
--    `auth.admin.inviteUserByEmail`, but only the service-role key may call it.
--    We store the project URL + service-role key in Postgres (vault-style
--    settings table, RLS-locked to service_role) so a trigger can ask Auth to
--    send the email. Optional: skip it and the app falls back to "copy link".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Invite preview (safe for anon)
-- ----------------------------------------------------------------------------
create or replace function public.invite_preview(invite_token text)
returns table (
  org_id      uuid,
  org_name    text,
  email       text,
  role        public.org_role,
  expires_at  timestamptz,
  accepted_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select i.org_id,
         o.name,
         i.email,
         i.role,
         i.expires_at,
         i.accepted_at
    from public.invites i
    join public.organizations o on o.id = i.org_id
   where i.token = invite_token
     and i.accepted_at is null
     and i.expires_at > now()
   limit 1;
$$;

revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Optional: email delivery settings
-- ----------------------------------------------------------------------------
-- Holds server-side secrets used to send invite emails. RLS is enabled and no
-- policies are created, so only the service role (and the security-definer
-- trigger below) can read or write it.
create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);
alter table public.app_settings enable row level security;

comment on table public.app_settings is
  'Server-only configuration (invite email delivery). No RLS policies: service role only.';

-- Store / rotate the values used to send invite emails:
--
--   select public.set_setting('project_url',          'https://<ref>.supabase.co');
--   select public.set_setting('service_role_key',     '<service-role-key>');
--   select public.set_setting('invite_redirect_url',  'https://yourdomain.com/auth/callback?next=/app');
--
-- Remove the key to disable email delivery (the app then only shows the link):
--   delete from public.app_settings where key = 'service_role_key';
create or replace function public.set_setting(setting_key text, setting_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_settings (key, value)
  values (setting_key, setting_value)
  on conflict (key) do update set value = excluded.value;
end $$;

revoke all on function public.set_setting(text, text) from public;
revoke all on function public.set_setting(text, text) from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Trigger: ask Supabase Auth to send the invite email
-- ----------------------------------------------------------------------------
-- Calls GoTrue's admin endpoint with the service-role key. Fails soft: if the
-- settings are absent or the request errors, the invite row still exists and
-- the admin can copy the link. `pg_net` is optional and only enabled when the
-- extension is available — the migration never fails because of it.
do $$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'pg_net not available — invite emails will be sent by the app instead';
  end;
end $$;

create or replace function public.notify_invite_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_url text;
  service_key text;
  redirect_to text;
  request_id  bigint;
begin
  -- Shareable links (no email) are not emailed anywhere.
  if new.email is null then
    return new;
  end if;

  select value into project_url from public.app_settings where key = 'project_url';
  select value into service_key   from public.app_settings where key = 'service_role_key';
  select value into redirect_to   from public.app_settings where key = 'invite_redirect_url';

  -- Email delivery not configured: the app falls back to "copy the link".
  if project_url is null or service_key is null or not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'http_post' and n.nspname in ('net', 'extensions')
  ) then
    return new;
  end if;

  select net.http_post(
    url     := project_url || '/auth/v1/invite',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'apikey', service_key,
                 'Authorization', 'Bearer ' || service_key
               ),
    body    := jsonb_build_object(
                 'email', new.email,
                 'data', jsonb_build_object('invite_token', new.token)
               ) ||
               case
                 when redirect_to is null then '{}'::jsonb
                 else jsonb_build_object('redirect_to', redirect_to)
               end
  ) into request_id;

  -- Record what we tried so the admin can see it in the audit trail.
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, meta)
  values (
    new.org_id,
    new.invited_by,
    'invite.emailed',
    'invites',
    new.id::text,
    jsonb_build_object('email', new.email, 'request_id', request_id)
  );

  return new;
exception when others then
  -- Never block invite creation because an email could not be queued.
  raise notice 'invite email not sent: %', sqlerrm;
  return new;
end $$;

drop trigger if exists on_invite_created on public.invites;
create trigger on_invite_created
  after insert on public.invites
  for each row execute function public.notify_invite_created();

-- ----------------------------------------------------------------------------
-- 4. One-time convenience: let a signed-in invitee read their own invite
-- ----------------------------------------------------------------------------
-- The invite page is usable while signed out via invite_preview(); once the
-- visitor signs up, accept_invite() does the seat assignment. Nothing else is
-- needed here — this block is intentionally a no-op placeholder for projects
-- that later add per-user invite lists.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 5. Dynamic task timing
-- ============================================================================
-- `deadline` (date) stays the source of truth for "when it's due"; these add
-- an exact due time and an optional start date so the UI can show live
-- countdowns ("Due today · 6h left") instead of a static date string.
alter table public.tasks add column if not exists start_date date;
alter table public.tasks add column if not exists due_time   time without time zone;

comment on column public.tasks.start_date is 'Optional day work starts (YYYY-MM-DD).';
comment on column public.tasks.due_time   is 'Optional exact due time; combined with deadline.';
