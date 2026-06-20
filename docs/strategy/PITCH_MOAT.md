# ResumeAI-Bot — Pitch & Moat (honest positioning)

**One line:** *The auto-apply tool that only sends applications you can actually win — eligibility-checked, tailored, and verified to truly submit.*

## The problem with the category
Auto-apply tools (LazyApply, Sonara, JobCopilot, Simplify) compete on **volume**:
"apply to 1,000 jobs a day." In practice that volume is hollow:
- Many "applications" **never actually submit** — the bot clicks a button on a job board
  that gates apply behind login/JS, so nothing reaches the employer.
- They apply to roles the candidate **can't legally work** (wrong country / visa), so the
  honest screening answer auto-rejects them before a human looks.
- The result: 2-star Trustpilot reviews, refund complaints, "it doesn't work."

We validated this directly: the high-volume job boards (RemoteOK, WeWorkRemotely,
Arbeitnow, Remotive, Himalayas) **architecturally hide the underlying apply URL** — even a
headless browser can't extract it. So "huge volume" auto-apply is, by construction, mostly
applications that don't land. **Volume is a vanity metric in this category.**

## Our moat — three things competitors structurally don't have
1. **Eligibility gate.** We only apply where the candidate is genuinely authorized to work
   (region/visa/seniority knockouts), so we never burn an application on a guaranteed
   auto-reject. Competitors assume "you can work anywhere."
2. **Verified submission (`_verify_submitted`).** We confirm each application *actually went
   through* (confirmation page / ATS acknowledgement), not "we clicked a button." This is the
   single hardest thing to fake and the clearest trust signal.
3. **Reply inbox.** Every recruiter reply is captured, classified (interview / question /
   rejection), and surfaced — the candidate sees *outcomes*, not a log of attempts.

These map to a defensible position: **"We don't sell volume. We sell applications that
count."** It's the anti-LazyApply stance, and it's the one thing a skeptical buyer (and a
diligent investor) can verify.

## Why this is fundable (and what NOT to claim)
- **Do** lead with the moat: eligibility-checked, tailored, **verified submitted**, replies in
  one inbox. Back it with the live `/admin/pmf` funnel + `/proof` page (real DB numbers).
- **Don't** promise "200 applications/day." The job-application ecosystem can't deliver that
  *honestly* (boards block automated apply; direct-ATS supply per narrow profile is finite).
  A volume promise creates churn + refunds and collapses under diligence.
- The investor story is the **funnel + the trust differentiator + week-over-week growth**, not
  one account's interview count.

## Honest metrics narrative (what we show)
`signups → resume → campaign → submitted (verified) → recruiter replies → interview → paid`,
all on the Stripe-reconciled `/admin/pmf` dashboard. Today's numbers are pre-launch/dogfood;
the *shape* and the *verifiability* are the asset.

## The honest constraint (say it out loud)
For a single candidate with a narrow profile, daily submittable volume is a *handful* of
genuinely-winnable roles — and interviews depend heavily on **profile quality** (a real
LinkedIn, named experience), which is the user's to provide. The product maximizes
*winnable, verified* reach; it does not manufacture a competitive candidate. That honesty is
the brand.

## Roadmap to more (honest) volume
The one technically-real lever to expand submittable supply is **Workable global search**
(~24k jobs, fillable) once the iframe-aware apply is hardened — see
[WORKABLE_APPLY_SCOPING.md](./WORKABLE_APPLY_SCOPING.md). Everything else (job boards) is a
dead end we've already proven out.
