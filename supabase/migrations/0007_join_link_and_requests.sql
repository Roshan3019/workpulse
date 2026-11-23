-- ============================================================================
-- 0007_join_link_and_requests.sql — one link, admin approval
--
-- Two ways into a studio, and the admin chooses which to use:
--
--   1. A targeted email invite (existing): the person accepts and is in.
--   2. A common join link (new): anyone with the link can *ask* to join. The
--      request lands in an inbox; nothing is granted until an admin approves.
--
-- Why a token on the organization rather than a row in `invites`
-- ---------------------------------------------------------------------------
-- `invites` models single use (accepted_at, expires_at, one seat). A studio
-- link is the opposite: long-lived, multi-use, and revocable. Squeezing it
-- into invites would mean either breaking those constraints or leaving unused
-- invites behind on every click.
--
-- Why RPCs
-- ---------------------------------------------------------------------------
-- The requester is authenticated but NOT a member, so every RLS policy in the
-- schema would reject them. Four narrow security-definer functions expose
-- exactly the operations needed and nothing else:
--
--   ensure_join_link()      admin   create-if-missing, return the link
--   rotate_join_link()      admin   new token, old one dead
--   join_link_preview()     anon    the org name, and whether it's open
--   request_to_join()       any     insert a pending request (idempotent)
--   decide_join_request()   admin   approve (creates membership) or decline
--
-- Each function re-checks the caller's role itself rather than trusting RLS,
-- because security definer bypasses RLS by design.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The studio's link
-- ---------------------------------------------------------------------------
create table if not exists public.join_links (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  token      text not null unique
             default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  enabled    boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.join_links enable row level security;

drop policy if exists join_links_select_admin on public.join_links;
create policy join_links_select_admin on public.join_links
  for select to authenticated using (public.is_org_admin(org_id));

drop policy if exists join_links_update_admin on public.join_links;
create policy join_links_update_admin on public.join_links
  for update to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop trigger if exists join_links_touch on public.join_links;
create trigger join_links_touch
  before update on public.join_links
  for each row execute function public.touch_updated_at();

grant select, update on public.join_links to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The requests
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.join_request_status as enum ('pending', 'approved', 'declined');
exception when duplicate_object then null;
end $$;

create table if not exists public.join_requests (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  note       text check (char_length(note) <= 500),
  status     public.join_request_status not null default 'pending',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- One open request per person per studio; history rows are allowed after a
-- decision so the inbox can show "declined last week" later.
create unique index if not exists join_requests_one_pending
  on public.join_requests (org_id, user_id)
  where status = 'pending';

create index if not exists join_requests_org_status_idx
  on public.join_requests (org_id, status, created_at);

alter table public.join_requests enable row level security;

drop policy if exists join_requests_select_admin on public.join_requests;
create policy join_requests_select_admin on public.join_requests
  for select to authenticated using (public.is_org_admin(org_id));

drop policy if exists join_requests_select_own on public.join_requests;
create policy join_requests_select_own on public.join_requests
  for select to authenticated using (user_id = auth.uid());

grant select on public.join_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPC: ensure_join_link — the admin sees their link, created on first ask
-- ---------------------------------------------------------------------------
create or replace function public.ensure_join_link(target_org uuid)
returns table (org_id uuid, token text, enabled boolean, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_org_admin(target_org) then
    raise exception 'Only admins can manage the join link';
  end if;

  insert into public.join_links (org_id, created_by)
  values (target_org, auth.uid())
  on conflict (org_id) do nothing;

  return query
    select l.org_id, l.token, l.enabled, l.created_at
      from public.join_links l
     where l.org_id = target_org;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RPC: rotate_join_link — a leaked link dies here
-- ---------------------------------------------------------------------------
create or replace function public.rotate_join_link(target_org uuid)
returns table (org_id uuid, token text, enabled boolean, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  new_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_org_admin(target_org) then
    raise exception 'Only admins can manage the join link';
  end if;

  insert into public.join_links (org_id, token, created_by)
  values (target_org, new_token, auth.uid())
  on conflict (org_id) do update
    set token = excluded.token,
        enabled = true,
        created_by = excluded.created_by,
        updated_at = now();

  return query
    select l.org_id, l.token, l.enabled, l.created_at
      from public.join_links l
     where l.org_id = target_org;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RPC: join_link_preview — safe for someone who is not signed in
--
-- Returns only the studio's name and whether the link is open. The token is
-- the secret; anyone holding it already knows the link exists.
-- ---------------------------------------------------------------------------
create or replace function public.join_link_preview(link_token text)
returns table (org_id uuid, org_name text, enabled boolean)
language sql stable security definer set search_path = public as $$
  select l.org_id, o.name, l.enabled
    from public.join_links l
    join public.organizations o on o.id = l.org_id
   where l.token = link_token
   limit 1;
$$;

revoke all on function public.join_link_preview(text) from public;
grant execute on function public.join_link_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC: request_to_join — ask, don't join
-- ---------------------------------------------------------------------------
create or replace function public.request_to_join(link_token text, request_note text default null)
returns table (org_id uuid, already_pending boolean)
language plpgsql security definer set search_path = public as $$
declare
  link record;
  existing uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;

  select * into link from public.join_links where join_links.token = link_token;
  if link is null then raise exception 'This link is no longer valid'; end if;
  if not link.enabled then raise exception 'This link is turned off'; end if;

  if exists (
    select 1 from public.memberships m
     where m.org_id = link.org_id and m.user_id = auth.uid()
  ) then
    raise exception 'You are already in this studio';
  end if;

  select r.id into existing
    from public.join_requests r
   where r.org_id = link.org_id and r.user_id = auth.uid() and r.status = 'pending';
  if existing is not null then
    return query select link.org_id, true;
    return;
  end if;

  insert into public.join_requests (org_id, user_id, note)
  values (link.org_id, auth.uid(), nullif(trim(coalesce(request_note, '')), ''));

  return query select link.org_id, false;
end $$;

-- ---------------------------------------------------------------------------
-- 7. RPC: decide_join_request — approve creates the membership
--
-- Mirrors accept_invite: idempotent for an existing member, seat-limited, and
-- audit-logged. Role is always 'member' — an admin is promoted afterwards if
-- the studio wants that, so a link can never mint an admin.
-- ---------------------------------------------------------------------------
create or replace function public.decide_join_request(
  target_org uuid,
  request_id uuid,
  approve boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  req record;
  lim int;
begin
  if not public.is_org_admin(target_org) then
    raise exception 'Only admins can decide join requests';
  end if;

  select * into req
    from public.join_requests
   where public.join_requests.id = request_id
     and public.join_requests.org_id = target_org
   for update;

  if req is null then raise exception 'That request no longer exists'; end if;
  if req.status <> 'pending' then raise exception 'That request was already decided'; end if;

  if approve then
    select seat_limit into lim from public.organizations where id = target_org;
    if not exists (
      select 1 from public.memberships where org_id = target_org and user_id = req.user_id
    ) then
      if public.org_seat_count(target_org) >= lim then
        raise exception 'This studio has reached its seat limit. Upgrade the plan first.';
      end if;
      insert into public.memberships (org_id, user_id, role, capacity)
      values (target_org, req.user_id, 'member', 40);
    end if;
  end if;

  update public.join_requests
     set status = case when approve then 'approved' else 'declined' end::public.join_request_status,
         decided_by = auth.uid(),
         decided_at = now()
   where public.join_requests.id = request_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, meta)
  values (
    target_org,
    auth.uid(),
    case when approve then 'join.approved' else 'join.declined' end,
    'join_requests',
    request_id::text,
    jsonb_build_object('user_id', req.user_id)
  );
end $$;
