# Enabling recruiter replies (inbound email)

> **Status (2026-05-30):** NOT working in production. Root cause + fix below.
> This is the only outstanding item from the full system audit — everything
> else is fixed, deployed, and live.

## Why replies don't arrive today

The app ingests replies via a **Resend inbound webhook** at
`POST /api/inbox/inbound` (see `app/api/inbox/inbound/route.ts`).

But the live DNS does **not** route mail to Resend:

```
$ dig +short MX resumeai-bot.ru
9  inbound-smtp.us-east-1.amazonaws.com.   # AWS SES (highest priority)
10 mx1.hosting.reg.ru.
20 mx2.hosting.reg.ru.
```

So when a recruiter replies to `handle@resumeai-bot.ru` (the address auto-apply
puts in the ATS form), the mail is delivered to **AWS SES / reg.ru** — neither
of which forwards it to the app. Result: `InboxMessage` stays empty
(the single existing row is just a Tolt verification code, not a real reply).

There is also an **outbound SPF gap**: the SPF record authorizes reg.ru only,
not Resend, which hurts deliverability of mail sent from `noreply@resumeai-bot.ru`.

## Why it can't be fixed from the server

- The `RESEND_API_KEY` on the VPS is a **send-only restricted key** — it cannot
  add domains or configure inbound (`401 restricted_api_key`).
- No registrar (reg.ru), AWS, or DNS-provider credentials exist on the VPS.

Both required changes need **your** login. Steps below.

---

## Recommended fix: Resend inbound on an `inbox.` subdomain

This keeps your existing root-domain mail (reg.ru) untouched and matches the
code, which already defaults to `inbox.resumeai-bot.ru`.

### 1. Resend dashboard — add the inbound domain
1. Resend → **Domains → Add Domain** → enter `inbox.resumeai-bot.ru`.
2. Resend shows DNS records to add (an **MX** record for inbound, plus
   **DKIM/SPF TXT** records). Copy the exact values it displays — the MX host
   is assigned per-account, do not guess it.

### 2. reg.ru DNS — add the records Resend gave you
In the reg.ru DNS editor for `resumeai-bot.ru`, add (host = `inbox`):
- `MX  inbox  <value-from-resend>  (priority per Resend)`
- `TXT inbox  <DKIM/SPF value-from-resend>`

Leave the **root** `resumeai-bot.ru` MX records as-is (don't touch reg.ru mail).

While here, fix outbound SPF — update the root `resumeai-bot.ru` TXT SPF to
include Resend:
```
v=spf1 ip4:31.31.196.221 a mx include:_spf.hosting.reg.ru include:amazonses.com ~all
```
(Use the include Resend specifies for your account — typically `amazonses.com`
since Resend sends via SES, or the value shown in the dashboard.)

### 3. Resend dashboard — point inbound at the webhook
1. Resend → **Inbound** (or **Webhooks**) → add endpoint:
   `https://resumeai-bot.ru/api/inbox/inbound`
2. Subscribe to the **`email.received`** (inbound) event.
3. Copy the signing secret (`whsec_...`).

### 4. VPS — flip the app to the subdomain + set the webhook secret
SSH to the VPS and edit `/opt/resumeai/.env`:
```
INBOX_DOMAIN=inbox.resumeai-bot.ru
RESEND_WEBHOOK_SECRET=whsec_xxx   # from step 3
```
Then restart web:
```
cd /opt/resumeai && docker compose up -d web
```
> Do this **only after** the subdomain MX is live, otherwise new applications
> would send a reply-to with no working mailbox.

### 5. Verify end-to-end
Send a test email to `test@inbox.resumeai-bot.ru` and confirm:
```
docker compose exec -T postgres psql -U resumeai -d resumeai \
  -c "SELECT \"fromEmail\", subject, classification, \"receivedAt\" \
      FROM \"InboxMessage\" ORDER BY \"receivedAt\" DESC LIMIT 5;"
```
A new row = the pipeline works. Replies will now auto-classify
(`INTERVIEW_REQUEST` → sets application to INTERVIEW; `REJECTION` → REJECTED).

---

## Alternative: keep AWS SES
The root MX already points to SES. You could instead build an
SES → SNS → webhook handler (SES receipt rule → SNS topic → POST to a new
`/api/inbox/inbound-ses` route). This is more code + AWS console work and only
makes sense if you specifically want to stay on SES. The Resend path above is
simpler and matches existing code.

---

## Secondary note: Telegram notifications go nowhere
All 4 users have **no Telegram chat linked** (`telegramUsername` empty;
notifier logs `event.no_chat`). Application/interview notifications are
published but silently dropped. This is an onboarding gap, not a code bug —
users must connect Telegram via the bot for notifications to deliver.
