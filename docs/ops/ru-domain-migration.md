# `.ru` → `.com`/`.io` migration note (decision pending)

**Why it matters (the trust risk):** our audience is job-seekers applying *abroad*.
A `.ru` TLD is a real conversion barrier — (1) perception (looks foreign/untrusted
for a Western job search), and (2) some corporate networks and email filters block
or down-rank `.ru`. This is a P0 *risk to report*, not a code fix — you decide if/when.

**Recommendation:** register a `.com` (best trust, ~$12/yr) — `.io` (~$35–60/yr) is
fine but slightly "techy". Run both: new domain becomes primary, `resumeai-bot.ru`
301-redirects to it permanently (keeps existing links/SEO equity).

## Cost
| Item | One-off | Recurring |
|------|---------|-----------|
| Domain (`.com`) | — | ~$12/yr |
| TLS | $0 (Caddy auto) | $0 |
| Engineering (cutover) | ~half a day | — |

## Steps (in order — do the allowlists BEFORE flipping `NEXTAUTH_URL`)
1. **Register** the domain; point its A/AAAA records at the VPS (`178.105.185.214`).
2. **OAuth allowlists first** — add the new callback URLs in Google + GitHub OAuth apps:
   `https://NEWDOMAIN/api/auth/callback/{google,github}` (keep the `.ru` ones during transition).
3. **Caddy** (`Caddyfile`): add a block for `NEWDOMAIN` (auto-TLS) serving `web:3000`,
   and change the apex `resumeai-bot.ru` block to `redir https://NEWDOMAIN{uri} permanent`
   (mirrors the existing `www → apex` redirect, so OAuth state/cookies stay on one origin).
4. **App env** (`/opt/resumeai/.env`): set `NEXTAUTH_URL=https://NEWDOMAIN` and
   `NEXT_PUBLIC_APP_URL=https://NEWDOMAIN`, then `docker compose up -d web`.
   (Stripe checkout success/cancel URLs are derived from `NEXT_PUBLIC_APP_URL` → auto-update.)
5. **Stripe**: add a webhook endpoint for `https://NEWDOMAIN/api/webhooks/stripe`
   (keep the `.ru` one until traffic moves), and update the account's branding/business URL.
   The IP allowlist on the secret key is unaffected (egress IP unchanged).
6. **Resend inbound (reply capture) — leave on `.ru` initially.** The inbox handles are
   `handle@inbox.resumeai-bot.ru`; migrating them needs a new MX + domain re-verify +
   `INBOX_DOMAIN` change + re-minting handles, which would break in-flight replies. Keep
   `inbox.resumeai-bot.ru` working via the 301-exempt subdomain; migrate the inbox later.
   (In `Caddyfile`, the redirect is on the apex only — the inbox subdomain MX is separate.)
7. **SEO**: update `app/sitemap.ts` / canonical / OG `metadataBase` to the new domain; add
   the new domain as a Search Console property; the 301s carry over ranking.

## Rollout safety
- Add new domain **alongside** `.ru`, verify OAuth + Stripe + a test sign-in on the new
  domain, *then* flip `NEXTAUTH_URL` + the 301. Keep the `.ru` 301 indefinitely.
- Risk if done out of order: flipping `NEXTAUTH_URL` before the OAuth callback allowlist is
  updated breaks sign-in (callback mismatch). Allowlist first.
