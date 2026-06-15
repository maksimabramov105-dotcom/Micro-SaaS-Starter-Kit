# Task 1 — Zero replies + Top-10 worldwide platforms (code-verified)

## A. Root cause (grounded in the actual repo)

Symptom: 300+ applications, near-zero human replies.

What the code already rules out:

- **Reply pipeline is healthy.** `docs/REPLIES_SETUP.md` documents a live signed `email.received` test (2026-05-30, `200` → `InboxMessage` created). Resend inbound + Svix verification (`lib/inbox/inbound-utils.ts`), handler `app/api/inbox/inbound/route.ts`, classifier `lib/inbox/classify.ts`. **Replies are not being lost.**
- **Submit path was hardened (P19).** `worker/worker/autoapply/careerops.py` gates success on `_verify_submitted()` (confirmation text / URL / form-gone), uploads a **real PDF** (`_render_resume_pdf`→`set_input_files`), and handles Greenhouse's emailed **security-code** step before reporting success.

The real causes, in order:

1. **Hardcoded dishonest eligibility (primary).** `careerops.py:284-285,383-384,769` always answers *"authorized to work in the US; does NOT require visa sponsorship"* for every job. An internationally-located candidate applying to US/EU on-site roles passes the auto-filter → confirmed application → **silently ghosted**. Exactly your symptom.
2. **No eligibility pre-filter + wrong target mix.** You apply heavily to US on-site roles where you're not authorized. The fix is to apply where you're *actually eligible* — **remote-first + international-friendly + startup/EU-SMB** roles — and skip the rest.
3. **Two known blind spots (in-repo):** LinkedIn replies are "LinkedIn inbox only — not email-trackable"; Telegram notifications drop (no users linked Telegram).
4. **Background silence is normal** for cold US-enterprise ATS (ghost jobs 68–81%, rare rejection emails). Remote/startup roles reply far more.

> **HH.ru / SuperJob: removed.** They denied your API access, so the only path would be scraping — high ban risk, fragile, not worth it. Dropped from the plan. (Optional future: a *manual-assist* mode that drafts the отклик and you paste it on HH yourself — zero automation, zero ban risk. Not auto-apply.)








### 
### 