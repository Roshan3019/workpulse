# Go live on Vercel — step by step

Follow this in order. Total time: about 25 minutes.
Everything below is verified against this repo (Next.js 16.4.6, Node 20.9+).

> **Read this first:** Vercel builds in **UTC**, and `NEXT_PUBLIC_*` variables are baked in at
> build time. Changing one later requires a **redeploy**, not just a save.

---

## Step 0 — What you need before starting

| Thing | Where |
|---|---|
| GitHub repo with `main` pushed | `Roshan3019/workpulse` |
| Supabase project | [supabase.com](https://supabase.com) → New project |
| Google Cloud project (for Google sign-in) | [console.cloud.google.com](https://console.cloud.google.com) |
| Vercel account | [vercel.com](https://vercel.com) — sign in **with GitHub** |

A free Supabase project is enough to launch. You can move to a paid project later by
re-running the migrations and re-pointing the env vars.

---

## Step 1 — Supabase: create the database

1. **supabase.com → New project**
   - Name: `workpulse`
   - Region: **closest to your users** (for India: *Mumbai / ap-south-1*)
   - Generate a strong database password and save it somewhere safe.
2. Wait ~2 minutes for provisioning.
3. Go to **SQL Editor → New query**.
4. Paste the **entire** contents of `supabase/migrations/0001_init.sql` → **Run**.
   You should see "Success. No rows returned".
5. **New query again** → paste `supabase/migrations/0003_invite_preview_and_email.sql` → **Run**.

> ⚠️ **On a brand-new project, do NOT run `0002_fix_invite_token.sql`.** `0001` already includes
> that fix. `0002` exists only for projects created *before* it.
>
> Skipping `0003` makes invite links fail with `invite_preview does not exist`.

**Verify (optional but recommended):** run this and expect `7` rows:

```sql
select tablename, rowsecurity from pg_tables
 where schemaname = 'public' and rowsecurity = true;
```

Every table should have `rowsecurity = true`.

---

## Step 2 — Supabase: copy the API keys

**Project Settings → API** (left sidebar):

| Copy this | Into this env var |
|---|---|
| **Project URL** (`https://xxxx.supabase.co`) | `NEXT_PUBLIC_SUPABASE_URL` |
| **anon / public** key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

> The **`service_role` key** is NOT needed by the app. Never put it in Vercel's environment
> variables — if it ever leaks, anyone can read every customer's data. (The optional invite-email
> feature stores it *inside Postgres* instead — see §8.)

---

## Step 3 — Supabase: turn on the auth providers

### Email + password

**Authentication → Providers → Email**: enabled by default. Leave **Confirm email ON**
(recommended for production).

### Google

**Authentication → Providers → Google** → toggle on. You'll paste the Client ID/Secret from
Step 4. Leave the window open.

---

## Step 4 — Google Cloud: OAuth credentials

1. [console.cloud.google.com](https://console.cloud.google.com) → create/select a project.
2. **APIs & Services → OAuth consent screen**
   - User type: **External** → Create
   - App name `WorkPulse`, your support email, developer email
   - Scopes: `openid`, `email`, `profile` (nothing else)
   - **Authorized domains:** add your Vercel domain later, e.g. `workpulse.vercel.app`
     (and your custom domain once you have it)
   - Publish the app (otherwise only test users can sign in)
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized JavaScript origins**
     ```
     https://workpulse.vercel.app
     https://yourdomain.com          ← add after you attach a custom domain
     http://localhost:8080           ← only if you also sign in locally
     ```
   - **Authorized redirect URI** (this one is Google → Supabase, not your app):
     ```
     https://<your-project-ref>.supabase.co/auth/v1/callback
     ```
     `<your-project-ref>` is the subdomain from your Supabase Project URL.
4. Copy the **Client ID** and **Client Secret** → paste into Supabase's Google provider →
   **Save**.

---

## Step 5 — Vercel: import the repo

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → `Roshan3019/workpulse`.
   (If it's not listed, click **Adjust GitHub App Permissions** and grant access to the repo.)
2. **Configure Project:**
   - Framework Preset: **Next.js** (auto-detected — don't change it)
   - Root Directory: `./` (leave as-is)
   - Build & Output Settings: **leave every default**
   - Node.js Version: **20.x or 22.x** (Next 16 needs ≥ 20.9)
3. **Environment Variables** — add these three now (name → value):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `anon` key |
   | `NEXT_PUBLIC_DEMO_MODE` | `0` |

   > `NEXT_PUBLIC_DEMO_MODE` must be exactly `0`. If it's missing or `1`, the site runs with
   > in-memory sample data and **every visitor sees fake users instead of your database.**
   > That's the single most common "it deployed but it's weird" cause.

4. Click **Deploy**. First build takes ~2 minutes. You'll get a URL like
   `https://workpulse-xxxx.vercel.app`.

---

## Step 6 — Connect the domain back to Supabase

Now that you know the real URL, tell Supabase to trust it.

**Supabase → Authentication → URL Configuration**

- **Site URL:** your production URL
  ```
  https://workpulse-xxxx.vercel.app
  ```
  (replace with your custom domain once attached)

- **Redirect URLs** — add every origin you will actually use:
  ```
  https://workpulse-xxxx.vercel.app/auth/callback
  https://workpulse-xxxx.vercel.app/**
  http://localhost:8080/auth/callback          ← only if you sign in locally
  https://*-your-team.vercel.app/**            ← preview deployments (optional)
  ```

> ⚠️ **This step is not optional.** If the Site URL is wrong, Google sign-in looks like it
> succeeded and then dumps people back on the login page. The app has a safety net for a stray
> `?code=`, but set this correctly anyway.

---

## Step 7 — Set the site URL env var and redeploy

Back in **Vercel → your project → Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://workpulse-xxxx.vercel.app` (no trailing slash) |

Then **Deployments → ⋯ on the latest → Redeploy**.

Why a second deploy: `NEXT_PUBLIC_*` values are compiled into the bundle. Saving the variable
without redeploying leaves the old value live. (Skip this and invite links will point at
`localhost:8080`.)

Set the same variable for **Preview** as well, with the production URL. Preview
deployments still use the request's own host for OAuth (that is the only origin whose
cookies survive the round trip), but email links built from the fallback should never
point at `localhost`.

### Deployment protection — check this before sharing a join link

**Vercel → project → Settings → Deployment Protection.** If *Vercel Authentication* covers
**All Deployments**, then every preview URL — including the branch alias
`workpulse-git-<branch>-<team>.vercel.app` — is gated behind a Vercel login. A teammate who
opens a join link on one of those URLs gets Vercel's sign-in page, not WorkPulse, which
looks exactly like the app is broken.

Two things follow:

1. Share join links that point at **production** (or a custom domain). Custom domains are
   never covered by the "all deployments" setting.
2. If you *do* want to test a join link on a preview, set protection to
   **Only Preview Deployments** *and* add the preview alias under **Protection Bypass for
   Automation**, or test on production instead.

---

## Step 8 — First sign-in, first workspace

1. Open your URL → **Start free** → sign up (or **Continue with Google**).
2. Confirm your email if you signed up with a password (Supabase sends it).
3. You land on **/onboarding** → name your workspace → you become the **owner**.
4. Open **Settings** and copy an invite link to test the flow in a private window.

### Optional: have Supabase email the invites for you

Copy-and-paste links work with no extra setup. To also send an email, run this **once** in the
Supabase SQL Editor — replacing the values:

```sql
select public.set_setting('project_url',         'https://<your-project-ref>.supabase.co');
select public.set_setting('service_role_key',    '<your-service-role-key>');
select public.set_setting('invite_redirect_url', 'https://workpulse-xxxx.vercel.app/auth/callback?next=/app');
```

Then brand the email in **Authentication → Email Templates → Invite user**.
The key lives inside Postgres (RLS-locked to `service_role`) — it is never exposed to the browser.
To switch it off: `delete from public.app_settings where key = 'service_role_key';`

---

## Step 9 — Smoke test (2 minutes)

Run these in a **private window** so you're signed out:

| # | Test | Expected |
|---|---|---|
| 1 | Open `/app` directly | redirected to `/login` |
| 2 | Sign in with Google | lands on `/app` (or `/onboarding`) **first time**, no bounce |
| 3 | Settings → Invite teammates → enter an email → Create invite | green box with a `/invite/...` link |
| 4 | Open that link in a **new private window** | shows "Join <your team>", not an error |
| 5 | Create account from that page | lands back on the invite → Accept → you're a member |
| 6 | Drag the task progress bar on **My tasks** | thumb moves, % updates, "Saved ✓" |
| 7 | Availability page | today's date is **your** date, one column per day |
| 8 | Resize to phone width | no horizontal scroll |
| 9 | **Availability** as a freelancer → paint an hour **busy**, save | it stays light red after refresh; the admin roster shows it red too |
| 10 | Freelancer → **My usual week** → set Mon–Fri, save → look at next week | next week is already filled in, without touching it |
| 11 | Admin → **Settings → Join link → Copy**, open in a private window as a **new** account | the page says you're *requesting* to join, not joining |
| 12 | Send that request | the page says **"Your request is waiting"** — it must **not** ask you to create a studio |
| 13 | Open `/onboarding` as that account | it says *waiting for approval*, not "name your workspace" |
| 14 | Admin **dashboard** → look at the request | the row shows the person's **name and email**, never "No name given" |
| 15 | Approve it | the inbox clears; the requester's next visit opens the dashboard as a member |
| 16 | Sign in as an account that belongs to **two studios** (one made by hand, one you were invited to) | it opens the studio you **joined last** — no studio switcher anywhere |
| 17 | Admin → **Assign new task** → tick **two people** from the same team | the **Team** field selects their team by itself; save, then open that team's tab |
| 18 | In the same dialog, pick somebody from Team 1 and force **Team 2** | an amber warning names the team; saving still works, and the task appears **only** under Team 2 |
| 19 | Freelancer → **Availability** → *My usual week* → drag across a row | the dragged hours paint; the hour labels (8a–7p) line up with the calendar underneath |
| 20 | Settings → seats, or a brand-new studio | the free plan covers **10** seats |

If #2 fails → Step 6. If #3 fails → Step 1 (did you run `0003`?). If #4 errors → `0003` again.
If #9 or #10 fails → did you run **`0006`** and **`0008`**? If #11–#15 fail → **`0007`** and **`0009`**.
If #14 shows "No name given" the admin simply cannot read the requester's profile: run `0009`.
If #17 or #18 misbehaves, or a shared task never shows up for the second person, run `0010`.
If #20 still says 5, run `0010` (it lifts free studios that are still on the old default).

---

## Step 10 — Custom domain (optional, ~5 minutes)

1. Vercel → Project → **Settings → Domains** → add `yourdomain.com` (and `www`).
2. Point DNS as Vercel shows you (usually an `A` record + `CNAME`). TLS is automatic.
3. **Then update all three places:**
   - Vercel env: `NEXT_PUBLIC_SITE_URL` → `https://yourdomain.com` → **Redeploy**
   - Supabase → Auth → URL Configuration: Site URL + redirect URLs
   - Google Cloud → Authorized JavaScript origins: add the domain

---

## Step 11 — Before you charge money

- [ ] Supabase → **Database → Backups**: confirm daily backups (Pro plan; free tier has none —
      take a manual dump before launch)
- [ ] Supabase → **Auth → Rate limits** sane; **Email templates** branded
- [ ] Optional: leaked-password protection, min password length 10
- [ ] Set a spend limit / usage alert in Vercel (Hobby has a soft cap)
- [ ] Two-account RLS test: create a second workspace, confirm you can't see the first one's data
- [ ] `robots.txt` / social preview look right at your real domain

Full security checklist: [`DEPLOYMENT.md`](./DEPLOYMENT.md) §3.

---

## The dashboard's team-slot view

The dashboard answers one day at a time: the **Team slots** card sits directly under
*Who's free this week* and shows one row per teammate, 8am–7pm across the top. It reads
the day from `?day=YYYY-MM-DD` (the seven-day picker writes it), and the team filter comes
from `?team=<slug>` — the same switcher the rest of the dashboard uses, so the card always
shows that team's people.

A day a teammate has not painted still shows their **usual week**: the dashboard folds
`availability.default_states` into any date with no row of its own, in one batched query
(`listWeeklyDefaults`). That is why the card can look full while a person's own page looks
empty, or vice versa — the precedence is the same rule the member page uses.

The hour rule never scrolls sideways. All twelve columns show from `lg`, eight from `sm`,
six on a phone; row totals and the whole-day bar underneath always count all twelve, so the
same day reads identically on a phone and a monitor.

---

## Migration order

Apply the files in `supabase/migrations/` **in numeric order**. Each one is
idempotent, so a re-run is safe, but skipping one will make the feature it
backs look broken rather than erroring:

| File | Enables | If it's missing |
|---|---|---|
| `0001_init.sql` | the schema itself | nothing works |
| `0002_fix_invite_token.sql` | invite tokens | invites 404 |
| `0003_invite_preview_and_email.sql` | invite pages for signed-out visitors, optional email delivery | invite link shows "no longer valid" |
| `0004_performance.sql` | indexes + RLS rewrites | slow, not broken |
| `0005_teams.sql` | teams, `tasks.team_id` | **Teams** page errors; the dashboard switcher is absent |
| `0006_availability_states.sql` | free / busy / unassigned | the availability grid saves nothing |
| `0007_join_link_and_requests.sql` | the common join link + approval inbox | **Settings → Join link** errors |
| `0008_availability_default.sql` | the weekly default | **My usual week** errors |
| `0009_join_request_details.sql` | admins can see *who* asked; `my_join_requests()` | the inbox says "No name given", and the join page cannot tell a waiting requester apart from a new one |
| `0010_multi_assign_tasks.sql` | `task_assignees` (a task can be shared), visibility for everyone on it, 10-seat free plan | a shared task is only visible to its lead, and the free plan stays at 5 seats |

The `hours` column on `availability` is still present on purpose: `0006` keeps
it in sync from `states` so older read paths stay correct. It can be dropped
once nothing reads it.

---

## Performance — why region matters

The single biggest factor in how fast this app feels is **where Vercel runs the server
functions relative to the Supabase database.** They must be in the same part of the world.

This project pins them in **`vercel.json`** at the repo root:

```json
{ "$schema": "https://openapi.vercel.sh/vercel.json", "regions": ["bom1"] }
```

> ⚠️ **Do not use a per-route `export const preferredRegion` in a layout or page.** It looks
> right, it type-checks, the build succeeds — and the Hobby plan silently ignores it. The
> deployment still reports `regions: ["iad1"]` and every query keeps crossing the planet.
> The region must be set for the whole project. `npm run test:perf` now fails if anyone
> reintroduces the per-route version.

That matches the Supabase project, which lives in **ap-south-1 (Mumbai)**. If you ever move
the Supabase project to another region, change this to the matching Vercel region:

| Supabase region | Vercel region |
|---|---|
| `ap-south-1` Mumbai | `bom1` |
| `ap-southeast-1` Singapore | `sin1` |
| `us-east-1` Virginia | `iad1` |
| `eu-west-1` Ireland | `dub1` |

**How to check whether it actually took effect.** This matters because the region is
invisible in the UI and a wrong deployment looks exactly like a correct one. Do **not** trust
the local build output — the build that shipped `iad1` had `bom1` in its local manifest.

Use the Vercel API for the deployment and read two fields:

```bash
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  https://api.vercel.com/v13/deployments/<deployment-id>?teamId=<team> \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const j=JSON.parse(d);console.log("regions:",j.regions,"origin:",j.originCacheRegion)})'
```

Correct output:

```
regions: [ 'bom1' ] origin: bom1
```

If it says `[ 'iad1' ]`, the functions are still in Virginia and everything will feel slow —
the `vercel.json` change did not reach the deployment. Redeploy and check again.

`npm run test:perf` fails if the region pin is ever removed or set per-route.

### Other things that keep it fast

- `getAuthContext()` is memoised with React `cache()`, so the layout and the page share one
  session resolution rather than each performing their own auth + profile + membership +
  organisation lookups.
- `orgMembers()` in `lib/data/request-cache.ts` is shared between the layout and five pages.
- Every `/app` route has a `loading.tsx`, so navigation paints the page shape immediately
  instead of appearing frozen.
- `supabase/migrations/0004_performance.sql` adds the indexes the queries need and makes
  Postgres evaluate `auth.uid()` once per query instead of once per row.
- `getStore()` is memoised per request too: every page used to build a fresh Supabase client
  (and re-read the auth cookie) on each of its four or five queries.
- The middleware only resolves the session on routes that read it (`/app`, `/onboarding`,
  `/auth`, `/invite`, `/join`, `/login`, `/signup`, `/`). Public pages and 404s no longer
  pay for a Supabase round trip.
- The client bundle ships compressed, without browser source maps, and `/app/loading.tsx`
  draws the dashboard's actual shape rather than a generic stack — a refresh now shows the
  page skeleton immediately instead of a blank tab.

### If it still feels slow

1. Confirm the deployment actually used the new code (Deployments → the latest build's
   commit should be the performance commit).
2. Check the region: a page pinned to `iad1` while the database is in Mumbai will always
   be slow, no matter what else you optimise.
3. Supabase free tier pauses idle compute; the first request after a quiet period can take
   a few seconds while the database wakes up. That is infrastructure, not the app.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Landing page shows "Demo mode is on" | `NEXT_PUBLIC_DEMO_MODE` missing or `1` | set `0` → **redeploy** |
| Google sign-in returns to `/login` | Site URL wrong in Supabase | Step 6 |
| `invite_preview does not exist` | `0003` not run | Step 1.5 |
| `gen_random_bytes(integer) does not exist` | old project, `0002` not run | run `0002` |
| Invite link points at `localhost:8080` | `NEXT_PUBLIC_SITE_URL` not set | Step 7 → **redeploy** |
| "Supabase is not configured" | env var typo / not redeployed | check names, redeploy |
| Build fails on Node version | Node < 20.9 | Project → Settings → Node.js Version |
| Emails never arrive | Supabase SMTP limits | Auth → Email; add your own SMTP provider |

---

## What "updating the site" looks like from here

1. Change code on a branch → push.
2. Vercel builds a **Preview** URL for that branch automatically.
3. Merge to `main` → Vercel deploys **Production** automatically.
4. If the update includes a **new SQL migration** in `supabase/migrations/`, run that file in the
   Supabase SQL Editor **before** (or right after) merging. Migrations are never run automatically.
5. If you changed a `NEXT_PUBLIC_*` variable, **redeploy** — saving alone does nothing.
