# Conversion Forensics — why 227 submissions → 0 interviews

**Date:** 2026-06-10 · **Prompt 10 Phase 1** · read-only prod analysis
**Premise:** ~1 interview / 40–50 apps → expected 5–6 from 227. We have **0** INTERVIEW_REQUEST. This is structural.

## Funnel (all-time, prod)

| Stage | Count | Notes |
|-------|------:|-------|
| Applications attempted | 375 | incl. failures |
| → SUBMITTED (`_verify_submitted` passed) | 227 | |
| → FAILED | 141 | mostly pre-fix phone/required-field rejects |
| → any inbound reply | ~312 msgs | most automated |
| → human reply | 20 | 19 REJECTION + 1 QUESTION |
| → **INTERVIEW_REQUEST** | **0** | |

## Root causes (ranked)

| # | Cause | Evidence | Status |
|---|-------|----------|--------|
| 1 | **98% of submissions had broken contact info.** Worker payload hardcoded `phone=''` / `linkedin_url=''`; real phone (`+61425440228`) sat unused in `resume.input`. Recruiters literally could not call/text; phone-required forms rejected (much of the 141 FAILED). | **223 of 227 SUBMITTED predate the contact fix (#50, 2026-06-10 10:43)**; only 4 after. | ✅ FIXED today (#50–#59: pass real contacts + intl-tel-input phone) |
| 2 | **Eligibility/geography mismatch — applied where the candidate can't be hired.** Profile is an Australian candidate (no US work authorization); applications went to **34 explicit "remote-US"** roles and many of **163 onsite/other** (largely US) roles. These are screening-knockouts before a human reads the resume. | geography signal on SUBMITTED: onsite/other 163, remote-US 34, remote-unspecified 30 | 🔧 **Phase 2 target** (remote_region + screening simulation) |
| 3 | **`eligibilityKnockout` treats ALL remote as eligible.** `lib/eligibility.ts` returns `null` for any `isRemote` job, so "Remote (US only)" passed straight through. | code: `if (job.isRemote) return null` | 🔧 Phase 2 |
| 4 | **No seniority control.** AND-keyword title match doesn't gate level; "Director/Manager, Customer Support" went out for an IC-level profile. | forensic titles incl. "Director, …Customer Support" | 🔧 Phase 2 |
| 5 | **No fit gate on the bulk of apps.** Only 22/227 carried a fit score (scoring shipped later); avg 76 where present. | scored=22/227 | ℹ️ now gated at 65; revisit threshold after clean data |
| 6 | **Resume quality (V2) per-app unknowable from git** (flag is env-based, not version-controlled). Flag is **ON now** (`RESUME_QUALITY_V2=true`, verified 2026-06-10). | env, not git | ℹ️ on now; future apps get V2 |

## Conclusion
The 0-interview outcome is **explained, not bad luck**: (1) almost every historical application was sent with no phone and (2) a large share targeted roles the candidate is ineligible for (US work-auth required). Both are now being addressed — contact data is fixed (deployed); geography/eligibility + seniority is Phase 2. **Conversion math should be computed only on post-fix, eligible, tailored applications** — essentially starting fresh from 2026-06-10.

**Honest expectation going forward:** first recruiter replies within days; interviews typically within 2–3 weeks at ~2–5% on *eligible, tailored* applications. Never promise "interview in 2 days."
