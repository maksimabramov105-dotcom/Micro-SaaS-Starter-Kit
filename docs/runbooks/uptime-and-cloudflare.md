# Runbook — uptime monitoring & Cloudflare break-glass

## TL;DR
- The site is on **Cloudflare DNS** (zone `d8fd258342ce61c91ef732142bb5d53b`, account
  `64afe494254f3c212406cf45df92a66d`) → **Caddy** (TLS/reverse proxy) → **web** container on the VPS.
- A cron uptime monitor emails the admin when the **public** site goes down and again when it recovers.
- If the origin is healthy but the public site hangs/errors, the cause is almost always **Cloudflare** —
  the fix is to **grey-cloud** (un-proxy) the DNS records.

---

## Uptime monitor

- Script: [`scripts/uptime_monitor.sh`](../../scripts/uptime_monitor.sh), installed on the VPS at
  `/opt/resumeai/scripts/uptime_monitor.sh`.
- Cron (root): `*/5 * * * * /opt/resumeai/scripts/uptime_monitor.sh >> /var/log/resumeai_uptime.log 2>&1`
- It curls `https://resumeai-bot.ru/` and emails `ADMIN_EMAILS` (first address) via Resend on an
  **up↔down transition only** (debounced). State file: `/var/tmp/resumeai_uptime_state`.
- Secrets are read live from `/opt/resumeai/.env` (`RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_EMAILS`).
- Test it: `printf down > /var/tmp/resumeai_uptime_state && /opt/resumeai/scripts/uptime_monitor.sh`
  (forces a "recovered" mail since the site is up), then it self-resets.

---

## Break-glass: public site down but origin is fine

**1. Confirm the origin is healthy (bypasses Cloudflare):**
```sh
ssh root@72.56.250.53
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --resolve resumeai-bot.ru:443:127.0.0.1 https://resumeai-bot.ru/
docker compose -f /opt/resumeai/docker-compose.yml logs --tail=50 caddy web
```
If that returns `200` quickly but the public URL hangs/errors, **Cloudflare is the problem**
(requests aren't even reaching Caddy — check the Caddy logs are silent).

**2. Grey-cloud (un-proxy) the DNS records** so traffic skips Cloudflare and hits the origin directly.
Needs a Cloudflare API token (scopes: **Zone → DNS:Edit**). In the dashboard: DNS → click the orange
cloud on the `@` and `www` A records → turn it grey. Via API:
```sh
ZONE=d8fd258342ce61c91ef732142bb5d53b
TOKEN=<cloudflare-token>
# list A records to get their ids + current content
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?type=A" | python3 -m json.tool
# for each record id, set proxied=false (keep the same name/content/ttl)
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/<RECORD_ID>" \
  --data '{"proxied":false}'
```
(Apex record id and `www` record id change if records are recreated — always re-list first.)
Grey-clouding works because Caddy serves a **real, browser-trusted Let's Encrypt cert** on the origin,
so the site is valid without Cloudflare in front. Propagation is ~1–5 min.

**3. Verify:** `curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' https://resumeai-bot.ru/`
from a machine *not* on the VPS.

---

## Permanent hardening: Cloudflare Origin CA + re-proxy (do when CF is healthy)

Grey-cloud is the emergency lever; it loses Cloudflare's CDN/WAF/DDoS protection. To get those back
**and** be immune to public-CA incidents (the class of outage on 2026-06-02):

1. In Cloudflare → SSL/TLS → Origin Server → **Create Certificate** (Origin CA cert, 15-yr).
2. Install it in Caddy for the site block with explicit `tls <cert.pem> <key.pem>` (this disables
   Caddy's automatic Let's Encrypt for that host — the cert is now **Cloudflare-issued**, which is
   **only trusted by Cloudflare**, so the site MUST stay proxied from then on).
3. Re-proxy the DNS records (`proxied=true`).
4. Set SSL/TLS mode to **Full (strict)**.
5. Verify the public URL returns `200`. Rollback = revert the Caddyfile `tls` line (back to auto-LE)
   and grey-cloud again.

> Do this only when Cloudflare has no active TLS/cert incident, and never mid-incident — it touches
> origin TLS. Check https://www.cloudflarestatus.com first.

---

## Incident log
- **2026-06-02:** Cloudflare incident "Issue with TLS certificates using Let's Encrypt CA" caused all
  public routes to hang ~25s while the origin was healthy (200 in <0.5s). Mitigated by grey-clouding
  the apex + `www` A records → site restored. Re-proxy + Origin CA deferred until CF marks it resolved.
