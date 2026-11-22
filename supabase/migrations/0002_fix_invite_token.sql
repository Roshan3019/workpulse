-- ============================================================================
-- WorkPulse — Fix invite creation: `function gen_random_bytes(integer) does not exist`
--
-- Run this in Supabase SQL Editor if you already applied 0001_init.sql.
-- Safe to run more than once (idempotent).
--
-- Root cause
-- ----------
-- 0001 generated invite tokens with pgcrypto's gen_random_bytes() + encode().
-- On Supabase, pgcrypto is installed into the `extensions` schema, while the
-- create_invite() RPC runs with `set search_path = public` — so the
-- unqualified gen_random_bytes(24) call cannot be resolved and every invite
-- fails with:
--   "create invite: function gen_random_bytes(integer) does not exist"
--
-- Fix
-- ---
-- Drop the pgcrypto dependency. Tokens are now built from gen_random_uuid(),
-- which is core PostgreSQL (13+) and needs no extension or schema lookup:
-- two UUIDs with dashes stripped = 64 lowercase hex chars (256 bits of
-- entropy — stronger than the old 48-char token). The `token` column is
-- plain `text`, so existing rows and invite links are unaffected.
-- ============================================================================

-- 1) Fix the column default for future direct inserts into invites.
alter table public.invites
  alter column token set default
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

-- 2) Fix the create_invite RPC (full function body, only the token
--    expression changed — seat-limit and audit behaviour are identical).
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

-- ----------------------------------------------------------------------------
-- Verify (optional — run these after the migration):
--
--   -- token default no longer references pgcrypto:
--   select column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'invites' and column_name = 'token';
--
--   -- sample token shape (expect 64 hex chars):
--   select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') as sample_token;
--
-- Then retry "Create invite" in the app — it should succeed.
-- ----------------------------------------------------------------------------
