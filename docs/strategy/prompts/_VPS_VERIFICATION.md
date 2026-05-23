# VPS deploy verification — REQUIRED at end of every prompt

> Every prompt below (01 through 09) must end with this verification block. If you (Claude Code) cannot SSH to the VPS in your environment, the deploy is NOT done — stop and ask the operator for SSH credentials or pipeline access. Do not declare the prompt complete with local-only changes.

## The block (paste verbatim at end of the prompt's "Definition of done")

```bash
# ── Production sync verification — hard fail ─────────────────────────────────

set -e

# 1. Right repo
git remote -v | grep -q "Micro-SaaS-Starter-Kit" || { echo "FATAL: wrong repo"; exit 1; }

# 2. Local branch is merged to main, and main is pushed
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "main" ]; then
  git fetch origin main
  git merge-base --is-ancestor HEAD origin/main \
    || { echo "FATAL: $CURRENT not merged to main yet"; exit 1; }
fi

# 3. VPS HEAD matches origin/main
LOCAL_SHA=$(git rev-parse origin/main)
VPS_SHA=$(ssh -o StrictHostKeyChecking=no root@resumeai-bot.ru \
  "cd /opt/resumeai && git rev-parse HEAD" 2>/dev/null) \
  || { echo "FATAL: cannot SSH to VPS — get credentials"; exit 1; }
[ "$LOCAL_SHA" = "$VPS_SHA" ] \
  || { echo "FATAL: VPS at $VPS_SHA, main at $LOCAL_SHA — deploy didn't run"; exit 1; }

# 4. All containers up
UP=$(ssh root@resumeai-bot.ru "cd /opt/resumeai && docker compose ps --status running --format '{{.Name}}'" | wc -l)
[ "$UP" -ge 5 ] || { echo "FATAL: only $UP containers running (expected ≥5)"; exit 1; }

# 5. Public site serves 200
curl -sf -o /dev/null -w "%{http_code}\n" https://resumeai-bot.ru/ | grep -q 200 \
  || { echo "FATAL: landing not 200"; exit 1; }

# 6. Worker is reachable through the web service
curl -sf -o /dev/null -w "%{http_code}\n" https://resumeai-bot.ru/api/health \
  | grep -q 200 \
  || { echo "FATAL: API health not 200"; exit 1; }

# 7. No new error spike in the last hour (Sentry) — soft warning, not a fail
echo "Reminder: open Sentry and confirm no new error issues since deploy."

# 8. If this prompt added a feature flag, confirm it's queryable
# (Replace <flag_key> per prompt, or remove if no flag was added.)
# ssh root@resumeai-bot.ru "cd /opt/resumeai && docker compose exec -T web \
#   npx prisma db execute --stdin <<< \"SELECT key, enabled FROM \\\"FeatureFlag\\\" \
#   WHERE key = '<flag_key>';\""

echo "✅ VPS verification: PASS — change is live on https://resumeai-bot.ru"
```

## Operator-side: SSH credential handoff

If Claude Code is running in an environment without VPS SSH access (e.g. a sandboxed Cowork session), the operator (you, Adam) must run the verification block manually after Claude Code reports "code merged to main, awaiting verification." Paste the output back to Claude Code so it can confirm.

This is the trade-off for using a Claude environment that can't SSH. The verification still happens — just with a human in the loop.

## What "deploy" means in this project

Per `.github/workflows/deploy.yml` in MSSK, deploy runs automatically on push to main:
1. CI tests pass
2. Build container images
3. Push to GHCR
4. SSH to VPS, pull new images, `docker compose up -d` (rolling, one image at a time per recent commit `c4f4a8a` to fit the 14GB disk)
5. Run post-deploy validation script

So a successful push to `main` SHOULD result in a VPS update within ~5 minutes. If the verification block fails on a clean push-to-main, the deploy pipeline itself is broken — escalate to the operator.

## Common failure modes and their fix

| Failure | Likely cause | Fix |
|---------|--------------|-----|
| `cannot SSH to VPS` | No SSH key in Claude environment | Operator runs verification manually |
| `VPS at $X, main at $Y` | CI deploy step failed silently | Check GitHub Actions logs for the latest run on main |
| `only N containers running` | One service crashed during deploy | `ssh ... docker compose logs <service>` to find why |
| `landing not 200` | nginx/Caddy misconfig or web container down | Check Caddy logs + web container logs |
| `API health not 200` | Worker or web service unhealthy | Check `docker compose ps` and per-service logs |
| `feature flag not found` | Migration didn't run | `npx prisma migrate deploy` on VPS |

## When to skip this verification

**Never for code changes.** Always for documentation-only changes (e.g. updates to files under `docs/`). For doc PRs, replace the block with: `# Docs-only PR — no VPS verification needed.`
