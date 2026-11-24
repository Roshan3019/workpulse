# Making invitation emails actually arrive

An admin types `someone@gmail.com`, presses **Create invite**, and that person
should get a real email with an **Accept invitation** button.

This page is the exact setup, because the app can only be as good as the mailer
behind it — and Supabase's *default* mailer deliberately refuses to.

---

## Why the default does not work

A brand-new Supabase project has **no SMTP server**. Its built-in mailer:

- **only delivers to addresses on your Supabase organisation's team**, and
- is **rate-limited to a handful of messages per hour**.

So the invitee's Gmail is rejected before it ever leaves Supabase. That is not a
bug in WorkPulse, and no code change can get around it: the message has to leave
through a mail server you control.

You have two good routes. Pick **one**.

---

## Route A — Resend (recommended, 5 minutes)

Free tier: 100 emails/day, 3,000/month. No domain needed to start.

1. **resend.com** → sign up → **API Keys** → *Create API Key* → copy it
   (`re_…`).
2. Vercel → your project → **Settings → Environment Variables** → add:

   | Name | Value | Environments |
   |---|---|---|
   | `RESEND_API_KEY` | `re_…` | Production, Preview, Development |
   | `INVITE_FROM_EMAIL` | `WorkPulse <onboarding@resend.dev>` | same |

   `onboarding@resend.dev` works immediately **but can only send to the email
   address you signed up to Resend with**. To email anybody, verify a domain
   (Resend → **Domains** → add `yourdomain.com`, add the DNS records it shows,
   wait for *Verified*), then set e.g.
   `INVITE_FROM_EMAIL=WorkPulse <hello@yourdomain.com>`.
3. **Redeploy** (Vercel bakes env vars at build time for the client; server
   vars are read per request, but a redeploy is the reliable way to be sure).
4. In WorkPulse: **Settings → Invite teammates**. The status line at the top now
   reads **“Email delivery on · Resend”**. Send one invite to yourself and check
   the inbox.

### Brevo instead of Resend

Same idea, same result — set `BREVO_API_KEY` and `INVITE_FROM_EMAIL` from a
Brevo sender you have verified (Brevo → **Senders, Domains & IPs**).

---

## Route B — Supabase + your own SMTP

Use this if you already have SMTP credentials (Zoho, Gmail Workspace,
Mailgun, Postmark, …) or you want *Supabase's own* confirmation emails to work
too, not just invites.

1. Supabase dashboard → your project → **Authentication → Emails → SMTP
   Settings** → *Enable custom SMTP*:
   - Host, port, username, password from your mail provider
   - Sender email + sender name (must be a domain you're allowed to send from)
2. Set **Project Settings → API → Project URL** and the **service_role** key as
   WorkPulse env vars (server-side only — never `NEXT_PUBLIC_`):

   | Name | Value |
   |---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key |
   | `INVITE_FROM_EMAIL` | the same sender you entered in Supabase |

   `NEXT_PUBLIC_SUPABASE_URL` is already set, and is what the mailer posts to.
3. Also raise **Authentication → Rate Limits → Emails per hour** if you are
   onboarding a whole team at once (defaults are low on the free plan).
4. Redeploy, then check **Settings → Invite teammates**: the line reads
   **“Email delivery on · Supabase + your SMTP”**.

With this route the invite email is Supabase's own, and its button lands the
person on `/auth/callback?next=/invite/<token>` — signed in, on the invite page,
joining the studio that invited them.

---

## Which one am I using?

The app tells you, on the invite panel itself, before you send anything:

| Line you see | Meaning |
|---|---|
| **Email delivery on · Resend** | Invitations go out from your Resend account. |
| **Email delivery on · Brevo** | Invitations go out from your Brevo account. |
| **Email delivery on · Supabase + your SMTP** | Supabase sends them, through your SMTP. Works for any address *once* SMTP is set up. |
| **Invitations are not emailed yet** | No provider configured. The link below the form still works — copy it and send it yourself. |

After each invite the panel quotes the provider's own answer, e.g.
*“Emailed to the address you entered, via Resend.”* or
*“Resend rejected it: The gmail.com domain is not verified.”* — so a failure is
never silent again.

---

## What never depends on email

The invite row is created first, and the link (`https://your-site/invite/<token>`)
is shown with a **Copy** button every time. If mail is down, misconfigured, or
rate-limited, the invite still works — paste the link into WhatsApp, Slack or an
email you send yourself.

---

## Checking it without sending anything

```sql
-- 1. Does the invite exist, and for whom? (accepts_at null = still open)
select email, role, created_at, accepted_at
  from public.invites
 order by created_at desc
 limit 10;
```

If a row exists with the right address, the *invite* worked and only *delivery*
is in question — which the panel now spells out in words.
