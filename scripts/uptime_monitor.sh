#!/usr/bin/env bash
# Public uptime monitor for resumeai-bot.ru.
#
# Curls the PUBLIC URL (not just the origin) every run and emails the admin via
# Resend on an up<->down *transition* only (debounced — no repeat spam while
# down, one "recovered" mail when it comes back). Because it hits the public
# hostname, it catches Cloudflare-level outages too, not just origin crashes.
#
# DEPLOYMENT (lives on the VPS, run from cron — NOT part of the app build):
#   install to: /opt/resumeai/scripts/uptime_monitor.sh   (chmod +x)
#   crontab -e (root):
#     */5 * * * * /opt/resumeai/scripts/uptime_monitor.sh >> /var/log/resumeai_uptime.log 2>&1
#
# Reads RESEND_API_KEY / RESEND_FROM / ADMIN_EMAILS straight from /opt/resumeai/.env
# so there are no duplicated secrets. Sends with curl (Resend's WAF 403s some
# default HTTP clients; curl is reliable).
set -u

ENVF=/opt/resumeai/.env
URL="https://resumeai-bot.ru/"
STATE=/var/tmp/resumeai_uptime_state

KEY=$(grep '^RESEND_API_KEY=' "$ENVF" | cut -d= -f2- | tr -d '"')
FROM=$(grep '^RESEND_FROM=' "$ENVF" | cut -d= -f2- | tr -d '"')
TO=$(grep '^ADMIN_EMAILS=' "$ENVF" | cut -d= -f2- | tr -d '"' | cut -d, -f1)

code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$URL" 2>/dev/null || echo 000)
if [ "$code" = "200" ]; then cur=up; else cur=down; fi

prev=$(cat "$STATE" 2>/dev/null || echo up)
printf '%s' "$cur" > "$STATE"

# No transition -> nothing to do.
[ "$cur" = "$prev" ] && exit 0

if [ "$cur" = down ]; then
  SUBJ="DOWN: resumeai-bot.ru (HTTP $code)"
  BODY="$URL returned HTTP $code at $(date -u +%FT%TZ). If the origin is healthy this is likely Cloudflare — grey-cloud the DNS records (see docs/runbooks/uptime-and-cloudflare.md, break-glass)."
else
  SUBJ="RECOVERED: resumeai-bot.ru back up"
  BODY="$URL recovered (HTTP $code) at $(date -u +%FT%TZ)."
fi

# Build JSON safely with python, send with curl.
JSON=$(FROM="$FROM" TO="$TO" SUBJ="$SUBJ" BODY="$BODY" python3 -c "import os,json;print(json.dumps({'from':os.environ['FROM'],'to':os.environ['TO'],'subject':os.environ['SUBJ'],'text':os.environ['BODY']}))")
curl -s -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  --data "$JSON" >/dev/null
