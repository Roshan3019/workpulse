-- ============================================================================
-- 0009_join_request_details.sql — the admin can see who asked
--
-- Three faults surfaced when a real person used a join link:
--
--   1. The inbox said "No name given" for everyone. `join_requests` is
--      readable by admins, but its embedded `profiles` row was not: the
--      profiles policy only lets you read yourself or a teammate, and a
--      *requester is not a teammate yet*. PostgREST silently returned null
--      for the embed, so the inbox lost the name and the email.
--
--   2. A requester who had no studio yet was pushed into "create a studio"
--      before their request could be sent. The server action asked for a
--      session *with an organisation* (requireSession) instead of merely a
--      signed-in user. Onboarding now knows about pending requests too, but
--      the rule belongs here as well: asking to join never requires a studio.
--
--   3. Asking twice could leave the inbox showing two rows for one person.
--      The unique index protects (org_id, user_id, pending) pairs, so a
--      second ask is a no-op — this makes that explicit, and lets a person
--      ask again only after a decline.
--
-- Everything is idempotent; re-running is safe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Admins may read the profile of anyone with a pending request in their org
--
-- A helper rather than an inline exists() so the policy stays readable and the
-- lookup cannot recurse into `join_requests` RLS (these functions are
-- security definer, which is the point).
-- ---------------------------------------------------------------------------
create or replace function public.is_pending_requester(candidate uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.join_requests r
     where r.user_id = candidate
       and r.status = 'pending'
       and public.is_org_admin(r.org_id)
  );
$$;

drop policy if exists profiles_select_pending_requester on public.profiles;
create policy profiles_select_pending_requester on public.profiles
  for select to authenticated
  using (public.is_pending_requester(profiles.id));

-- ---------------------------------------------------------------------------
-- 2. RPC: my_join_requests — "is anyone deciding on me?"
--
-- The requester is not a member, so `organizations` is invisible to them
-- through RLS; the join page and the onboarding screen both need the studio's
-- name (and the link back) to be honest about what is happening.
-- ---------------------------------------------------------------------------
create or replace function public.my_join_requests()
returns table (
  id         uuid,
  org_id     uuid,
  org_name   text,
  status     public.join_request_status,
  note       text,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id,
         r.org_id,
         o.name,
         r.status,
         r.note,
         r.created_at
    from public.join_requests r
    join public.organizations o on o.id = r.org_id
   where r.user_id = auth.uid()
     and r.status = 'pending'
   order by r.created_at asc;
$$;

revoke all on function public.my_join_requests() from public;
grant execute on function public.my_join_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPC: request_to_join — same contract, better guarantees
--
-- * backfills the caller's own profile from auth metadata, so the admin never
--   sees "No name given" for someone who does have a Google name;
-- * one pending request per studio, whatever the client retries;
-- * a declined request can be sent again (approval cannot: that means a
--   membership already exists, which is still refused).
-- ---------------------------------------------------------------------------
create or replace function public.request_to_join(link_token text, request_note text default null)
returns table (org_id uuid, already_pending boolean)
language plpgsql security definer set search_path = public as $$
declare
  link record;
  existing uuid;
  caller_id uuid := auth.uid();
begin
  if caller_id is null then raise exception 'Sign in first'; end if;

  select * into link from public.join_links where join_links.token = link_token;
  if link is null then raise exception 'This link is no longer valid'; end if;
  if not link.enabled then raise exception 'This link is turned off'; end if;

  if exists (
    select 1 from public.memberships m
     where m.org_id = link.org_id and m.user_id = caller_id
  ) then
    raise exception 'You are already in this studio';
  end if;

  /*
   * Fill in a missing name/avatar from the provider's metadata. `profiles` is
   * written by a trigger on signup, but a row can predate that trigger or have
   * arrived with an empty name — and an inbox saying "No name given" is the
   * one thing that makes approving someone a guess.
   */
  insert into public.profiles (id, email, full_name, avatar_url)
  select caller_id,
         coalesce(auth.jwt()->>'email', ''),
         coalesce(auth.jwt()->'user_metadata'->>'full_name', auth.jwt()->'user_metadata'->>'name'),
         auth.jwt()->'user_metadata'->>'avatar_url'
  on conflict (id) do update
    set email      = coalesce(nullif(excluded.email, ''), public.profiles.email),
        full_name  = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        updated_at = now();

  select r.id into existing
    from public.join_requests r
   where r.org_id = link.org_id
     and r.user_id = caller_id
     and r.status = 'pending';

  if existing is not null then
    -- Keep the newest words the person wrote, but never a second row.
    if nullif(trim(coalesce(request_note, '')), '') is not null then
      update public.join_requests
         set note = nullif(trim(request_note), '')
       where public.join_requests.id = existing;
    end if;
    return query select link.org_id, true;
    return;
  end if;

  insert into public.join_requests (org_id, user_id, note)
  values (link.org_id, caller_id, nullif(trim(coalesce(request_note, '')), ''));

  return query select link.org_id, false;
end $$;
