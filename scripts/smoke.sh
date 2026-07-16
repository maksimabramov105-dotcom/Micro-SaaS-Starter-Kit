#!/usr/bin/env bash
# smoke.sh — one-command production smoke test (canonical; replaces smoke_test.sh).
#
# Checks (Section 2.4 of docs/MASTER_PLAN.md):
#   1. Key pages return 200 over valid TLS and contain a known string
#      (/, /pricing, /login, /faq) + health endpoints + NextAuth sanity.
#   2. All resumeai-* containers are Up (run locally on the VPS, or via SSH
#      from a dev machine, or skipped when neither is available — e.g. CI).
#   3. Recent web logs are free of errors (warn-only unless SMOKE_STRICT_LOGS=1).
#
# CONNECTION BUDGET: the VPS rate-limits new per-IP connections (rapid
# sequential curls/SSH sessions get dropped on both 443 and 22). All page
# checks therefore share ONE curl process (keep-alive), and all infra checks
# share ONE SSH session. Keep it that way when adding checks.
#
# Usage:
#   bash scripts/smoke.sh                 # or: npm run smoke
#   BASE_URL=http://localhost:3000 bash scripts/smoke.sh
#
# Env vars:
#   BASE_URL          — default: https://resumeai-bot.ru
#   SMOKE_SSH_HOST    — SSH target for infra checks off-VPS (default: root@178.105.185.214)
#   SMOKE_SKIP_INFRA  — set to 1 to skip container/log checks (HTTP only)
#   SMOKE_STRICT_LOGS — set to 1 to hard-fail on recent web error log lines
#   ADMIN_WEBHOOK_URL — optional webhook for failure alerts

set -uo pipefail

BASE_URL="${BASE_URL:-https://resumeai-bot.ru}"
SMOKE_SSH_HOST="${SMOKE_SSH_HOST:-root@178.105.185.214}"
SMOKE_SKIP_INFRA="${SMOKE_SKIP_INFRA:-0}"
SMOKE_STRICT_LOGS="${SMOKE_STRICT_LOGS:-0}"
ADMIN_WEBHOOK_URL="${ADMIN_WEBHOOK_URL:-}"

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

FAILED=0

log()  { echo "[$(date -u +%T)] $*"; }
fail() { echo "[$(date -u +%T)] FAIL: $*" >&2; FAILED=1; }
warn() { echo "[$(date -u +%T)] WARN: $*"; }

notify_failure() {
  local msg="$1"
  if [[ -n "$ADMIN_WEBHOOK_URL" ]]; then
    curl -fsS --max-time 5 -X POST "$ADMIN_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"ResumeAI smoke test FAILED: ${msg}\"}" || true
  fi
}

# ── 1. Pages & endpoints — fetched in ONE curl process ───────────────────────

# NOTE: with --next, curl options are per-segment — repeat -sS -m per URL.
log "Fetching ${BASE_URL} pages (single connection)"
curl \
  -sS -m 30 -o "$T/home"      -w "home %{http_code}\n"      "${BASE_URL}/"                   --next \
  -sS -m 30 -o "$T/pricing"   -w "pricing %{http_code}\n"   "${BASE_URL}/pricing"            --next \
  -sS -m 30 -o "$T/login"     -w "login %{http_code}\n"     "${BASE_URL}/login"              --next \
  -sS -m 30 -o "$T/faq"       -w "faq %{http_code}\n"       "${BASE_URL}/faq"                --next \
  -sS -m 30 -o "$T/health"    -w "health %{http_code}\n"    "${BASE_URL}/api/health"         --next \
  -sS -m 30 -o "$T/whealth"   -w "whealth %{http_code}\n"   "${BASE_URL}/api/worker/health"  --next \
  -sS -m 30 -c "$T/jar" -o "$T/csrf" -w "csrf %{http_code}\n" "${BASE_URL}/api/auth/csrf"    --next \
  -sS -m 30 -o "$T/providers" -w "providers %{http_code}\n" "${BASE_URL}/api/auth/providers" \
  > "$T/statuses" 2> "$T/curl_err" || warn "curl reported: $(head -1 "$T/curl_err")"

status_of() { grep "^$1 " "$T/statuses" | awk '{print $2}'; }

# Status must be 2xx. TLS validation is implicit: curl fails on a bad cert.
check_status() {
  local name="$1" label="$2"
  local status
  status=$(status_of "$name")
  if echo "${status:-000}" | grep -qE "^2"; then
    log "  OK ${label} (HTTP ${status})"
  else
    fail "${label} -- HTTP ${status:-no response}"
    notify_failure "${label} -- HTTP ${status:-none}"
  fi
}

# Body must contain a required string (proves the page actually rendered).
check_body() {
  local name="$1" label="$2" required="$3"
  if grep -q "$required" "$T/$name" 2>/dev/null; then
    log "  OK ${label}"
  else
    fail "${label} -- body missing '${required}' (HTTP $(status_of "$name"))"
    notify_failure "${label} -- missing '${required}'"
  fi
}

check_body   home      "homepage"              "ResumeAI"
check_body   pricing   "pricing page"          "Pricing"
check_status login     "login page"
check_body   faq       "faq page"              "FAQ"
check_status health    "web /api/health"
check_status whealth   "worker health (proxy)"
check_body   csrf      "NextAuth CSRF"         "csrfToken"
check_body   providers "OAuth providers"       "google"

# OAuth sign-in initiation: POST with a fresh CSRF token must redirect to
# Google, not bounce back with ?error= (catches broken NEXTAUTH_URL/OAuth env).
CSRF_TOKEN=$(grep -o '"csrfToken":"[^"]*"' "$T/csrf" 2>/dev/null | cut -d'"' -f4) || CSRF_TOKEN=""
if [[ -z "$CSRF_TOKEN" ]]; then
  warn "auth sign-in check skipped -- could not obtain CSRF token"
else
  SIGNIN_LOCATION=$(curl -sS -m 20 -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -b "$T/jar" \
    -d "csrfToken=${CSRF_TOKEN}" \
    -o /dev/null -w "%{redirect_url}" \
    "${BASE_URL}/api/auth/signin/google" 2>/dev/null) || SIGNIN_LOCATION=""
  if echo "$SIGNIN_LOCATION" | grep -q "accounts.google.com"; then
    log "  OK auth sign-in (redirects to Google)"
  elif echo "$SIGNIN_LOCATION" | grep -q "error="; then
    fail "auth sign-in BROKEN -- redirects to '${SIGNIN_LOCATION}' instead of Google"
    notify_failure "OAuth sign-in broken -- ${SIGNIN_LOCATION}"
  else
    warn "auth sign-in redirect unclear (${SIGNIN_LOCATION:-no redirect}) -- soft check"
  fi
fi

# ── 2+3. Infra checks (containers + recent web errors) — ONE remote call ─────
# Three modes: local (on the VPS itself), ssh (dev machine), skip (CI runner).

INFRA_CMD='docker ps -a --format "{{.Names}}\t{{.Status}}" | grep "^resumeai-"; echo "===WEBLOGS==="; docker logs --since 10m resumeai-web 2>&1 | grep -iE "error|unhandled" | grep -viE "favicon" | head -5'

INFRA_MODE="skip"
if [[ "$SMOKE_SKIP_INFRA" != "1" ]]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^resumeai-web$'; then
    INFRA_MODE="local"
  elif [[ -n "$SMOKE_SSH_HOST" ]]; then
    INFRA_MODE="ssh"
  fi
fi

INFRA_OUT=""
case "$INFRA_MODE" in
  local) INFRA_OUT=$(bash -c "$INFRA_CMD" 2>/dev/null) || true ;;
  ssh)
    INFRA_OUT=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SMOKE_SSH_HOST" "$INFRA_CMD" 2>/dev/null) || {
      warn "SSH to ${SMOKE_SSH_HOST} unavailable -- infra checks skipped"
      INFRA_MODE="skip"
    } ;;
esac

if [[ "$INFRA_MODE" == "skip" ]]; then
  log "Infra checks skipped (HTTP checks only)"
else
  log "Infra checks (mode: ${INFRA_MODE})"
  CONTAINERS=$(echo "$INFRA_OUT" | sed '/^===WEBLOGS===$/,$d')
  WEB_ERRORS=$(echo "$INFRA_OUT" | sed '1,/^===WEBLOGS===$/d')

  for svc in web worker notifier db redis caddy; do
    line=$(echo "$CONTAINERS" | grep "^resumeai-${svc}[[:space:]]" || true)
    status=$(echo "$line" | cut -f2)
    if [[ -z "$line" ]]; then
      fail "container resumeai-${svc} not found"
      notify_failure "container resumeai-${svc} missing"
    elif echo "$status" | grep -q "^Up"; then
      if echo "$status" | grep -q "unhealthy"; then
        fail "container resumeai-${svc} is UNHEALTHY (${status})"
        notify_failure "container resumeai-${svc} unhealthy"
      else
        log "  OK resumeai-${svc} (${status})"
      fi
    else
      fail "container resumeai-${svc} is DOWN (${status})"
      notify_failure "container resumeai-${svc} down -- ${status}"
    fi
  done

  if [[ -n "$WEB_ERRORS" ]]; then
    if [[ "$SMOKE_STRICT_LOGS" == "1" ]]; then
      fail "recent web error log lines found:"
      echo "$WEB_ERRORS" >&2
      notify_failure "web error log lines in last 10m"
    else
      warn "recent web error log lines (last 10m) -- review:"
      echo "$WEB_ERRORS"
    fi
  else
    log "  OK web logs clean (last 10m)"
  fi
fi

# ── Result ───────────────────────────────────────────────────────────────────

if [[ "$FAILED" -ne 0 ]]; then
  log "SMOKE FAILED -- check container logs"
  exit 1
fi
log "All smoke checks passed"
