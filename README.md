# WorkPulse

Multi-tenant SaaS for freelancer teams: live workload per person, client tasks with deadlines, and
drag-to-paint availability calendars. Built to be sold — every customer gets an isolated workspace
with its own roles, seats and data.

**Stack:** Next.js 16 (App Router, Server Actions, Turbopack) · React 19 · TypeScript (strict) ·
Tailwind CSS v4 · Supabase (Postgres + Auth + RLS) · deployable on Vercel.

---

## 1. Run it in 60 seconds (demo mode, no backend)

```bash
npm install
npm run dev          # http://localhost:8080
```

With no `.env.local`, the app runs in **demo mode**: an in-memory store seeded with a full sample
studio (8 people, 10 tasks, 14 days of availability) and a user picker on `/login`. Every screen and
interaction works — including drag-to-paint availability and role changes.

> Demo data lives in the server process memory and resets when the server restarts.

---

## 2. Go live (Supabase + Google)

### 2.1 Create the database
1. Create a project at [supabase.com](https://supabase.com) (pick the region closest to your users).
2. **SQL Editor → New query** → paste [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → **Run**.
   This creates the tables, helper functions, triggers and **Row Level Security policies**.
3. Copy your keys from **Project Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → **never put this in the frontend**. Server scripts only.

### 2.2 Enable auth
1. **Authentication → Providers → Email**: enable. Decide whether to require email confirmation
   (recommended: on).
2. **Authentication → Providers → Google**: enable and paste a Google OAuth **Client ID + Secret**
   (see 2.3).
3. **Authentication → URL Configuration**
   - Site URL: `https://yourdomain.com`
   - Redirect URLs: `https://yourdomain.com/auth/callback`, `http://localhost:8080/auth/callback`

### 2.3 Google OAuth
1. [Google Cloud Console](https://console.cloud.google.com) → create/select a project.
2. **APIs & Services → OAuth consent screen** → External → app name, support email, scopes
   `openid`, `email`, `profile`. Add your domain under *Authorized domains*.
3. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorized JavaScript origins: `https://yourdomain.com`, `http://localhost:8080`
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
4. Paste the Client ID/Secret into Supabase's Google provider.

### 2.4 Configure the app
```bash
cp .env.example .env.local
```
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=http://localhost:8080
NEXT_PUBLIC_DEMO_MODE=0
```
Restart `npm run dev` → the demo banner disappears, `/login` shows real Google + email/password, and
signing up routes you to `/onboarding` to create your organization.

### 2.5 Make yourself the first owner
Sign up, create your workspace → you are automatically the `owner` (the `create_organization` RPC
does this atomically). Everyone else joins through an invite as a `member`.

---

## 3. Deploy to Vercel

1. Push this repo to GitHub.
2. [vercel.com](https://vercel.com) → **Add New → Project** → import the repo. Framework is detected
   automatically (no build tweaks needed).
3. **Environment Variables** — add the same four keys as `.env.local`, with
   `NEXT_PUBLIC_SITE_URL=https://yourdomain.com` and `NEXT_PUBLIC_DEMO_MODE=0`.
4. Deploy, then add the production URL to:
   - Supabase → Authentication → URL Configuration
   - Google Cloud → Authorized JavaScript origins
5. (Recommended) add `www`/apex domain in Vercel → Settings → Domains. HTTPS is automatic.

Docker/self-hosting and the full launch checklist: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## 4. What's inside

```
src/
├── app/
│   ├── page.tsx                 marketing site (hero, features, pricing)
│   ├── login/ signup/           auth (Google + email/password)
│   ├── onboarding/              create the first organization
│   ├── invite/[token]/          accept an invite link
│   ├── auth/callback/           Supabase OAuth code exchange
│   └── app/                     authenticated product
│       ├── layout.tsx           shell: nav, plan meter, user menu
│       ├── page.tsx             admin dashboard (workload + overall time slots)
│       ├── tasks/               all tasks, filters, assign/edit/delete
│       ├── team/                roles, capacity, remove member
│       ├── availability/        member = editable calendar · admin = view-only
│       ├── my-tasks/            freelancer view (progress + status)
│       └── settings/            workspace, invites, plan, ownership transfer
├── components/                  ui primitives + feature components
├── lib/
│   ├── actions/                 server actions (auth, tasks, team, availability, org)
│   ├── data/                    repository layer: memory.ts (demo) + supabase.ts (prod)
│   ├── supabase/                server + browser clients (@supabase/ssr)
│   ├── session.ts               auth context + role guards (requireSession/requireAdmin)
│   ├── workload.ts              utilisation + free-slot maths (pure, testable)
│   ├── dates.ts                 date/hour helpers, range formatting
│   ├── validation.ts            zod schemas for every mutation
│   └── types.ts                 domain types + plan definitions
├── proxy.ts                     middleware: session refresh + /app route guard
supabase/migrations/0001_init.sql   schema, triggers, RLS, RPCs
docs/DEPLOYMENT.md                  deploy + launch + security checklist
```

### Business rules (enforced in the database, not just the UI)

| Rule | Where |
|---|---|
| Nobody can change their own role | `guard_membership_update` trigger + `changeRoleAction` + disabled UI |
| Admins can't touch the owner's role | same trigger |
| An org always keeps one owner | `guard_last_owner` trigger |
| Admins/owners don't have availability | `guard_availability_role` trigger |
| Admins see availability but cannot write it | RLS: `availability_select` allows admin read, writes are self-only |
| Members can only move progress/status on their own tasks | `guard_task_update` trigger |
| Members can't see other members' tasks | RLS `tasks_select` |
| Seat limits block invites | `create_invite` RPC checks `seat_limit` |
| Cross-tenant access is impossible | every table carries `org_id`; every policy checks `is_org_member(org_id)` |

---

## 5. Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `0.0.0.0:8080` |
| `npm run build` | Production build (Turbopack) |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` (strict) |

---

## 6. Product decisions you can change

- **Plans** live in `src/lib/types.ts → PLANS` (free 5 / pro 25 / business 100 seats). Change the
  numbers and re-run the SQL `seat_limit` default; the UI and gating follow.
- **Pricing is display-only** until Stripe is connected — `setPlanAction` records an upgrade request
  in production instead of granting a paid plan silently.
- **Roles**: `owner | admin | member`. Add e.g. `viewer` by extending the `org_role` enum and the
  `ROLE_LABEL` map.
- **Availability window** is 6am–10pm (`src/lib/dates.ts`) and the calendar shows 14 days.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the security checklist, backups, monitoring and
the Stripe/multi-org roadmap.
