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

If #2 fails → Step 6. If #3 fails → Step 1 (did you run `0003`?). If #4 errors → `0003` again.

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
