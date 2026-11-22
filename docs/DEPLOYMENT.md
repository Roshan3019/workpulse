# Deployment, security & launch checklist

This is the "before you charge money for it" document. Work top to bottom.

---

## 1. Environments

| Environment | Supabase | Google OAuth | Notes |
|---|---|---|---|
| Local | (optional) your dev project | `http://localhost:8080` in JS origins | demo mode works with no backend |
| Preview (Vercel) | same project, separate schema or a second project | add the preview domain | optional |
| Production | dedicated project, **daily backups on** | production domain only | `NEXT_PUBLIC_DEMO_MODE=0` |

Never point production at the same Supabase project as dev — a stray migration or a wiped table is a
customer-data incident.

---

## 2. Deploy paths

### Vercel (recommended)
1. Import the repo → framework auto-detected → add env vars → deploy.
2. Custom domain → Vercel issues TLS automatically.
3. Add the domain to Supabase **Redirect URLs** and Google **Authorized JavaScript origins**.

### Docker / VPS
```dockerfile
# Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 8080
CMD ["npm","start"]
```
```bash
docker build -t workpulse .
docker run -p 8080:8080 --env-file .env.production workpulse
```
Put nginx/Caddy in front for TLS. Caddy is two lines:
```
workpulse.yourdomain.com {
  reverse_proxy 127.0.0.1:8080
}
```

**Build-time vs runtime env:** `NEXT_PUBLIC_*` values are inlined at build time. If you change them
on Vercel, redeploy. In Docker, pass them as build args or bake `.env.production` into the builder stage.

---

## 3. Security checklist

### Database (Supabase)
- [ ] `0001_init.sql` applied (plus `0002_fix_invite_token.sql` if `0001` was applied before the
      invite-token fix — otherwise "Create invite" fails with
      `function gen_random_bytes(integer) does not exist`); **RLS enabled on every table** (verify in Database → Tables, the lock
      icon should be on for `profiles`, `organizations`, `memberships`, `invites`, `tasks`,
      `availability`, `audit_log`).
- [ ] Test with two accounts in different orgs: member A cannot read org B's tasks
      (`select * from tasks` returns only their org).
- [ ] Verify a member cannot update someone else's task's `est_hours` (trigger raises
      `Members can only update progress and status`).
- [ ] Verify an admin cannot change their own role (trigger raises `You cannot change your own role`).
- [ ] Verify an admin cannot insert an availability row (trigger raises
      `Availability is only tracked for members`).
- [ ] `service_role` key is **not** in any `NEXT_PUBLIC_*` variable and not in the repo.
- [ ] Turn on **Point-in-time recovery / daily backups** (Database → Backups).
- [ ] Set **Auth → Rate limits** and **Auth → Email templates** with your brand.
- [ ] Optional: enable **leaked password protection** and a minimum password length of 10.

### App
- [ ] `NEXT_PUBLIC_DEMO_MODE=0` in production (demo mode bypasses auth by design).
- [ ] Every mutation goes through a server action that calls `requireSession()`/`requireAdmin()` and a
      zod schema — no unvalidated write paths.
- [ ] Security headers are set in `next.config.ts` (nosniff, frame options, referrer policy, HSTS,
      permissions policy). Add a CSP once you know your asset origins:
      `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://<project>.supabase.co; connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co; frame-ancestors 'none'`
- [ ] Invite links are single-use + expire in 14 days (`invites.expires_at`, `accepted_at`).
- [ ] Redirect targets after OAuth are restricted to relative paths (`/auth/callback` route).
- [ ] Add a WAF/rate limit in front of `/login` and `/signup` (Vercel Firewall or Cloudflare).
- [ ] Rotate the anonymous key only if it leaks; rotate the service key after any exposure.

### Operations
- [ ] Uptime check on `/` (200) and an authenticated `/app`.
- [ ] Error tracking (Sentry) wired to `next.config.ts` → `instrumentation.ts`.
- [ ] Postgres logs/alerts for slow queries; add indexes if a customer exceeds ~50k tasks.
- [ ] Audit log: `audit_log` already records org creation, invites, acceptances and ownership
      transfers. Add rows in the server actions for task deletions if you need full history.

---

## 4. Data model cheat-sheet

```
organizations (id, name, slug, plan, seat_limit)
  ├── memberships (org_id, user_id, role[owner|admin|member], capacity)  ← the "team"
  ├── invites     (org_id, email?, role, token, expires_at, accepted_at)
  ├── tasks       (org_id, title, client, assignee_id, est_hours, progress, status, priority, deadline)
  ├── availability(org_id, user_id, slot_date, hours int[])              ← members only
  └── audit_log   (org_id, actor_id, action, entity, entity_id, meta)

profiles (id → auth.users, email, full_name, avatar_url)
```

Useful queries:

```sql
-- who is overloaded this week (open hours vs capacity)
select p.full_name, sum(t.est_hours) as open_hours, m.capacity
from memberships m
join profiles p on p.id = m.user_id
left join tasks t on t.assignee_id = m.user_id and t.status <> 'done' and t.org_id = m.org_id
where m.org_id = '<org>'
group by p.full_name, m.capacity
order by open_hours desc;

-- free hour totals per member for the next 7 days
select p.full_name, sum(cardinality(a.hours)) as free_hours
from availability a join profiles p on p.id = a.user_id
where a.org_id = '<org>' and a.slot_date between current_date and current_date + 6
group by p.full_name order by free_hours desc;
```

---

## 5. Connecting Stripe later (the seams are already there)

1. Add `stripe` + `stripe` webhook route: `src/app/api/stripe/webhook/route.ts`.
2. Columns already exist on `organizations`: `plan`, `seat_limit`. Add
   `stripe_customer_id`, `stripe_subscription_id`, `plan_renews_at`.
3. Replace the body of `setPlanAction` (`src/lib/actions/org.ts`) with a Checkout Session create call;
   the plan card UI already disables itself for non-owners.
4. On `checkout.session.completed` / `customer.subscription.updated` (webhook, service-role client):
   `update organizations set plan = $1, seat_limit = $2 where id = $3` using the same seat numbers as
   `PLANS` in `src/lib/types.ts`.
5. Add a customer-portal link in Settings → Plan & seats.

Because seats are enforced in the DB (`create_invite` checks `seat_limit`), revenue and product rules
can't drift apart.

---

## 6. Scaling notes

- Reads are all indexed by `org_id`; the RLS predicates use the `memberships` primary key path.
- Server actions are short and stateless → they scale horizontally on Vercel's serverless runtime.
- The dashboard fetches members + tasks + 7 days of availability in 3 queries (parallelised with
  `Promise.all`). If a customer grows past a few hundred tasks, add a materialised "workload" view.
- Supabase connection pooling (pgBouncer) is on by default for the REST/PostgREST path used here.

---

## 7. Roadmap that makes this easier to sell

1. **Billing** (above) — per-seat subscription with a 14-day trial.
2. **Organisation switcher** — a user in two workspaces (schema already supports it; `wp_org` cookie is
   the seam).
3. **Client-facing share links** — read-only availability + progress page per client, expiring tokens.
4. **Auto-scheduling** — drag a task onto the calendar; the app proposes slots from free hours vs
   estimate.
5. **Time tracking** — log actual hours, then utilisation uses actuals instead of estimates.
6. **Notifications** — deadline reminders via email/WhatsApp; weekly utilisation digest.
7. **Exports** — CSV/PDF per client for invoicing.
