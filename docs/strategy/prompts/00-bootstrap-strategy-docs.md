# Prompt 00 — Bootstrap: commit + push strategy docs into MSSK

> **Run this FIRST, before any other prompt. It puts all the strategy documents into the repo on `main` so every later Claude Code session can read them. After this, every numbered prompt below can be pasted into Claude Code and it will know exactly where to look for context.**
>
> Total time: ~2 minutes. No risk — docs-only commit.

## What this prompt does
1. Confirms you are in the `Micro-SaaS-Starter-Kit` working tree
2. Confirms `docs/strategy/` exists and contains all the strategy files
3. Commits them on a new branch `chore/strategy-docs-bootstrap`
4. Opens a PR (or pushes directly to `main` if you prefer) so the docs reach GitHub
5. Verifies the docs are visible on GitHub after push

## Step 1 — Confirm location

```bash
# You must be at the root of the MSSK working tree
pwd | grep -q "Micro-SaaS-Starter-Kit$" \
  || { echo "FATAL: cd to your local MSSK clone first"; exit 1; }

# Confirm the strategy folder exists and has all expected files
required=(
  docs/strategy/STRATEGIC_ANALYSIS.md
  docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md
  docs/strategy/prompts/README.md
  docs/strategy/prompts/_VPS_VERIFICATION.md
  docs/strategy/prompts/00-bootstrap-strategy-docs.md
  docs/strategy/prompts/01-system-audit.md
  docs/strategy/prompts/02-resume-quality-upgrade.md
  docs/strategy/prompts/03-pdf-templates.md
  docs/strategy/prompts/04-stability-hardening.md
  docs/strategy/prompts/05-annual-plans-and-pricing.md
  docs/strategy/prompts/06-2fa-optional-later.md
  docs/strategy/prompts/07-referral-and-affiliate.md
  docs/strategy/prompts/08-feature-flags-and-ab-testing.md
  docs/strategy/_archive/README.md
)
missing=0
for f in "${required[@]}"; do
  [ -f "$f" ] || { echo "MISSING: $f"; missing=$((missing+1)); }
done
[ "$missing" -eq 0 ] || { echo "FATAL: $missing strategy files missing"; exit 1; }
echo "✅ All $((${#required[@]})) strategy files present"
```

## Step 2 — Commit on a clean branch and open a PR

```bash
git fetch origin
git checkout -b chore/strategy-docs-bootstrap origin/main

git add docs/strategy/
git status   # eyeball — should be ONLY files under docs/strategy/

git commit -m "docs(strategy): bootstrap strategy + prompts + corrections + VPS verification

Adds:
- docs/strategy/STRATEGIC_ANALYSIS.md (master strategic doc + competition + 10K roadmap)
- docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md (drift corrections per real repo audit)
- docs/strategy/prompts/00..08-*.md (Claude Code execution prompts in order)
- docs/strategy/prompts/_VPS_VERIFICATION.md (hard-fail VPS sync block)
- docs/strategy/prompts/README.md (execution order + operating principles)
- docs/strategy/_archive/* (superseded migration docs, preserved for history)

Docs-only commit. No application code changed."

git push -u origin chore/strategy-docs-bootstrap
```

Open the PR using the URL printed by `git push`, OR if you have the `gh` CLI:
```bash
gh pr create \
  --title "docs(strategy): bootstrap strategy + prompts + corrections + VPS verification" \
  --body "Docs-only. See docs/strategy/prompts/README.md for execution order." \
  --base main \
  --head chore/strategy-docs-bootstrap
```

Merge the PR (squash-merge is fine; this is one logical change).

## Step 3 — Verify on GitHub

```bash
# After merge, confirm main has it
git fetch origin
git log origin/main --oneline | head -5 | grep -q "strategy.*bootstrap" \
  && echo "✅ Strategy docs on main" \
  || echo "❌ Not yet — check the PR"

# Spot-check the URL — should return 200 (no auth required if repo is public)
curl -sI "https://raw.githubusercontent.com/maksimabramov105-dotcom/Micro-SaaS-Starter-Kit/main/docs/strategy/prompts/README.md" \
  | head -1
```

## Step 4 — Tell future Claude Code where to look

After this prompt runs, every later prompt (01–08) instructs Claude Code to read `docs/strategy/STRATEGIC_ANALYSIS.md`, `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md`, and `docs/strategy/prompts/_VPS_VERIFICATION.md` before doing anything. Those files now exist on `main`. No more out-of-band context to pass around.

## Rules
- This prompt does NOT touch any application code. Pure docs.
- If `docs/strategy/` is missing or incomplete in your local clone, stop and re-copy from the original delivery folder. Do not commit a partial bootstrap.
- Squash-merge the PR. One commit on main is cleaner than 14.

## Definition of done
- All 14 required files exist locally under `docs/strategy/`
- PR `chore/strategy-docs-bootstrap` is merged to `main`
- `git log origin/main` shows the bootstrap commit
- Raw GitHub URL for `docs/strategy/prompts/README.md` returns 200
- You can now copy-paste Prompt 01 into a fresh Claude Code session and it will find everything it needs in the repo
