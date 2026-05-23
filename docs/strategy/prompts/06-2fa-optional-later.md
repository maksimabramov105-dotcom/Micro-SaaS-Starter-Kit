# Prompt 06 — 2FA (TOTP + recovery codes) — DEFERRED

> **Do NOT run until after $5K MRR or your first enterprise inquiry. This is specced and ready, but it does not move the needle right now.**
>
> 🚨 **VPS hard-fail:** when run, end with the block from `docs/strategy/prompts/_VPS_VERIFICATION.md`.

## Why deferred
Per `docs/strategy/STRATEGIC_ANALYSIS.md` §6.2: 2FA does not block revenue. Email + Google + GitHub OAuth covers your security baseline. The customers you're chasing for the next 90 days will not ask for it. Use this prompt when:
- An enterprise/B2B prospect asks for it
- You cross ~500 paying users
- You have a security incident

## When you DO run it — read these first
1. `lib/auth.ts` — NextAuth config + JWT callback
2. `prisma/schema.prisma` — `User` model
3. `app/dashboard/settings/page.tsx` — where the toggle UI will live
4. `docs/ARCHITECTURE.md` Auth section

## Plan

### Step 1 — Library choice
Use [`otplib`](https://github.com/yeongjet/otplib) for TOTP and `qrcode` for QR generation. Both are zero-controversy, no native deps. **Do not roll your own crypto.**

```bash
npm install otplib qrcode @types/qrcode
```

### Step 2 — Schema
Add to `User` model:
```prisma
twoFactorSecret    String?
twoFactorEnabled   Boolean  @default(false)
twoFactorBackups   String[] // hashed bcrypt-style
```
Migration: `add_two_factor_fields`.

### Step 3 — Endpoints
- `POST /api/auth/2fa/setup` → generate secret, store encrypted (use existing `ENCRYPTION_KEY`), return QR code + recovery codes (one-time display)
- `POST /api/auth/2fa/verify` → user submits 6-digit TOTP code on first setup; only then is `twoFactorEnabled` flipped to true and recovery codes shown
- `POST /api/auth/2fa/disable` → requires current TOTP, clears secret and backups
- `POST /api/auth/2fa/challenge` → during login, if `twoFactorEnabled`, ask for TOTP; accept either TOTP or one of the recovery codes (recovery code is consumed)

### Step 4 — NextAuth flow
Add a `2fa-required` intermediate state in the JWT. After OAuth/credentials returns a valid user, if `twoFactorEnabled`, set `session.requires2fa = true` and redirect to a `/auth/2fa` page that handles the challenge. Only after challenge succeeds, set `session.authenticated = true`.

### Step 5 — UI
In `app/dashboard/settings/page.tsx`, add a "Two-factor authentication" section:
- If disabled: "Set up" button → modal with QR code + instructions
- If enabled: "Manage" → regenerate recovery codes, disable
- Always show: "Last verified at <timestamp>"

### Step 6 — Recovery flow
Recovery codes are bcrypt-hashed before storage. On use, scan all recovery hashes for a match, mark used, persist. Show user "X recovery codes remaining" in settings.

### Step 7 — Lockout
If 5 failed TOTP attempts in 10 minutes, lock 2FA challenge for that user for 15 minutes (log to Sentry as a `2fa_lockout` event). Use Redis to track attempts.

### Step 8 — Tests
- Setup → verify → enable
- Login with TOTP succeeds
- Login with recovery code succeeds + consumes code
- Login with wrong code 5× → locked
- Disable requires current TOTP

## Rules when you do build it
- Use `ENCRYPTION_KEY` already present in env (don't introduce a new secret)
- Recovery codes shown ONCE — never retrievable
- 2FA off does NOT mean account-deletion required: user can simply turn off
- Mark 2FA as a Pro+ feature in pricing copy (small "Security: 2FA" line in features)
- Commit on a branch `feat/2fa-totp`, full unit + integration tests required before merge

## Definition of done (when run)
- All 4 endpoints implemented + tested
- UI in settings works end-to-end
- 5 failed attempts locks for 15 min, logged to Sentry
- Documented in `docs/ARCHITECTURE.md` Auth section
- VPS git HEAD matches GitHub main
