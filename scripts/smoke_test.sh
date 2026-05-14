#!/usr/bin/env bash
# smoke_test.sh — post-deploy health checks.
#
# Env vars:
#   BASE_URL          — default: https://resumeai-bot.ru
#   ADMIN_WEBHOOK_URL — Telegram/Slack webhook for failure alerts (optional)

set -euo pipefail

BASE_URL="${BASE_URL:-https://resumeai-bot.ru}"
ADMIN_WEBHOOK_URL="${ADMIN_WEBHOOK_URL:-}"
TIMEOUT=15

FAILED=0

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { echo "[$(date -u +%T)] $*"; }
fail() { echo "[$(date -u +%T)] ❌ $*" >&2; FAILED=1; }

notify_failure() {
  local msg="$1"
  if [[ -n "$ADMIN_WEBHOOK_URL" ]]; then
    # Works for both Telegram bot webhooks and Slack incoming webhooks
    curl -fsS --max-time 5 -X POST "$ADMIN_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"🚨 ResumeAI smoke test FAILED: ${msg}\"}" \
      || true   # never let the notification itself abort the script
  fi
}

check() {
  local label="$1"
  local url="$2"

  log "Checking ${label} → ${url}"
  if curl -fsS --max-time "$TIMEOUT" "$url" > /dev/null 2>&1; then
    log "  ✅ ${label} OK"
  else
    fail "${label} failed (${url})"
    notify_failure "${label} — ${url}"
  fi
}

# ── Checks ────────────────────────────────────────────────────────────────────

check "web /api/health"        "${BASE_URL}/api/health"
check "worker /api/worker/health" "${BASE_URL}/api/worker/health"

# ── Result ────────────────────────────────────────────────────────────────────

if [[ "$FAILED" -ne 0 ]]; then
  log "❌ Smoke tests FAILED — check container logs"
  exit 1
fi

log "✅ All smoke tests passed"
