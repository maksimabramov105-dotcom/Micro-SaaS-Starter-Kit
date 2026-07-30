# Domain migration runbook — resumeai-bot.ru → resumeai-bot.com

Written 2026-07-30 against the **real** state of the account, not a template.
Every fact below was read from the live Cloudflare API, the live VPS, the live
Resend API and the live database.

## Current state (verified)

| Thing | Value |
|---|---|
| Cloudflare zone, old | `resumeai-bot.ru` — id `d8fd258342ce61c91ef732142bb5d53b`, active |
| Cloudflare zone, new | `resumeai-bot.com` — id `8c0737388a51d7eb2dd950b78199b97e`, **active, NS delegated** |
| New domain A record | **none** — `resumeai-bot.com` does not resolve |
| Origin | `178.105.185.214` (Hetzner CX23) |
| Caddy vhosts | `resumeai-bot.ru` (proxy → web:3000, `/api/worker/*` → worker:8000) and `www.resumeai-bot.ru` → 301 |
| Prod env | `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL`, `RESEND_FROM`, `INBOX_DOMAIN` all on `.ru` |
| Resend verified domains | **`resumeai-bot.ru` only** |
| Users with inbox handles | **9** on `@inbox.resumeai-bot.ru` |
| Sitemap | 301 URLs, all indexed on `.ru` |

## Two things that will break if you rush this

1. **Email.** Resend has only `resumeai-bot.ru` verified. Flip `RESEND_FROM` to
   `.com` before verifying it there and **every transactional email stops** —
   magic-link sign-in, rescue delivery, refunds, nurture.
2. **Reply inbox.** 9 users hold `@inbox.resumeai-bot.ru` addresses. Repointing
   `INBOX_DOMAIN` does not migrate them; their inbound mail silently stops.
   `INBOX_DOMAIN` migrates **last and separately**, and `.ru` MX must keep
   accepting mail indefinitely.

The code is already prepared: `lib/site.ts` derives the domain and the support
addresses from `NEXT_PUBLIC_APP_URL`, with `EMAIL_DOMAIN` as a separate override
precisely so mail can stay on `.ru` while the site moves to `.com`.

## Blocked on you (cannot be automated from here)

| # | Item | Why |
|---|---|---|
| 1 | **Cloudflare token scope** | The token supplied has `Zone:Read` only. `GET /zones` works; `GET /zones/{id}/dns_records` returns **403**. Create a token with **Zone → DNS → Edit** (and Zone → Zone → Read) for both zones. |
| 2 | **Google Search Console / Bing** | Requires signing into your Google/Microsoft accounts. |
| 3 | **OAuth callbacks** | Google Cloud Console + GitHub OAuth app redirect URIs must gain the `.com` origin, or sign-in breaks on the new domain. |
| 4 | **`gh auth refresh -s workflow`** | Interactive OAuth device flow; cannot run in a non-interactive session. |

Rotate the Cloudflare token and R2 keys that were shared in chat once this is done.

## Order of operations

Steps 1–4 are additive and safe: `.ru` keeps serving throughout.

### 1. DNS (needs token fix)
```
A    resumeai-bot.com       -> 178.105.185.214   proxy OFF   (Caddy needs :80 for ACME)
A    www.resumeai-bot.com   -> 178.105.185.214   proxy OFF
```
Proxy stays **off** until Caddy has issued a certificate; turn it on afterwards
if you want Cloudflare in front.

### 2. Caddy — serve `.com` alongside `.ru`
Add to `/opt/resumeai/Caddyfile`, keeping the `.ru` block untouched:
```
www.resumeai-bot.com {
	redir https://resumeai-bot.com{uri} permanent
}

resumeai-bot.com {
	encode gzip
	header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
	handle_path /api/worker/* { reverse_proxy worker:8000 }
	reverse_proxy * web:3000
	log { output file /var/log/caddy/access.log { roll_size 50mb roll_keep 5 } format json }
}
```
`docker compose restart caddy`, then confirm TLS issued and the app answers on
`.com`. Both domains now serve the same app — nothing has switched yet.

### 3. Resend — verify the new sending domain
Add `resumeai-bot.com` in Resend, publish the DKIM/SPF records it returns in
Cloudflare, wait for `status=verified`. **Do not change `RESEND_FROM` until it
reads verified.**

### 4. Stripe + OAuth
- Stripe: add a webhook endpoint for `https://resumeai-bot.com/api/webhooks/stripe`
  subscribed to the same events; keep the `.ru` endpoint until traffic moves.
- Google/GitHub OAuth: add the `.com` redirect URIs (owner).

### 5. Flip the app (the actual switch)
On the VPS `.env`:
```
NEXT_PUBLIC_APP_URL=https://resumeai-bot.com
NEXTAUTH_URL=https://resumeai-bot.com
RESEND_FROM=noreply@resumeai-bot.com     # only after step 3 says verified
EMAIL_DOMAIN=resumeai-bot.com            # only after step 3
INBOX_DOMAIN=resumeai-bot.ru             # LEAVE on .ru — see the warning above
```
Redeploy. Canonicals, sitemap, robots, JSON-LD, OG URLs and support addresses
all follow automatically via `lib/site.ts`.

**Sessions:** changing `NEXTAUTH_URL` invalidates existing cookies — everyone is
signed out once. Expected, worth saying out loud.

### 6. Redirect the old domain (only after `.com` is confirmed good)
Replace the `.ru` Caddy block with a permanent redirect, preserving the path:
```
resumeai-bot.ru, www.resumeai-bot.ru {
	redir https://resumeai-bot.com{uri} permanent
}
```
A 301 passes ranking signal. Keep it **forever** — 301s are how the 301 indexed
URLs transfer.

Exception: keep `/api/webhooks/stripe` and the inbound-mail endpoint reachable on
`.ru` until Stripe and inbound mail are fully moved, or redirect them explicitly
rather than blanket-301ing POSTs.

### 7. Search engines
- GSC: add `resumeai-bot.com` (Domain property, TXT in Cloudflare), submit
  `sitemap.xml`, then use **Change of Address** on the `.ru` property → `.com`.
  That tool is the single highest-value step for keeping rankings.
- Bing: Import from GSC.
- IndexNow: the key file is served from `/public`, so it moves with the app.
  Re-submit the full sitemap on the new host after the flip.

### 8. Inbox domain (separate, later)
Only once `.com` MX is live and the 9 existing `.ru` handles still receive:
mint new handles on `.com`, keep accepting `.ru` indefinitely.

## Rollback

Through step 5, rollback is reverting the `.env` values and redeploying. After
step 6, remove the `.ru` redirect block to restore it. Nothing here is
destructive; the risky, irreversible-ish part is search-engine Change of Address,
which is why it comes last and only after `.com` is verified healthy.
