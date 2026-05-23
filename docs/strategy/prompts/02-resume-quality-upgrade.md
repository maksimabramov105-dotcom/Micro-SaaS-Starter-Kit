# Prompt 02 — Resume quality upgrade (STAR/CAR + ATS keywords + self-critique)

> **Paste into Claude Code. This MODIFIES production AI prompts in the worker. Behind a feature flag. Surgical edits only.**
>
> ⚠️ **READ FIRST: `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.1.** The system prompts in this repo are stored as external `.txt` files in `worker/worker/ai/prompts/`, NOT as Python module constants. The corrections doc tells you exactly how to translate Change 1 below. Do NOT inline the prompts in Python — create new `*_v2.txt` files alongside the existing ones. Treat the corrections doc as authoritative when it conflicts with the text below.
>
> 🚨 **VPS hard-fail:** end with the verification block from `docs/strategy/prompts/_VPS_VERIFICATION.md`. No prompt is complete until production reflects the change.

## Why
Every competitor (Sonara, Simplify, LazyApply) has the same user complaint: AI resume output is generic and embarrassing. We will win on quality. Three changes, all in the Python worker:
1. Replace the resume-generation system prompt with a STAR/CAR constraint-based prompt
2. Add a per-job ATS keyword extraction step that guarantees keyword presence
3. Add a self-critique pass that rewrites bullets failing a rubric

Combined token cost increase: ~2.5× per resume. At gpt-4o-mini that's <$0.01. Worth it.

## Read these first (in this order)
1. `docs/strategy/STRATEGIC_ANALYSIS.md` §2 — why this is the wedge against competition
2. `docs/strategy/WORKTREE_AUDIT_AND_CORRECTIONS.md` §3.1 — overrides for this prompt
3. `docs/ARCHITECTURE.md` — Worker + Resume & autoapply sections
4. `worker/worker/ai/prompts/resume.txt` — current system prompt (external file, NOT a Python constant)
5. `worker/worker/ai/prompts/tailor_resume.txt`
6. `worker/worker/ai/prompts/tailor_cover_letter.txt`
7. `worker/worker/ai/prompts/cover_letter.txt`
8. `worker/worker/ai/resume.py` — current generation logic + `_call_openai` helper (reuse this, don't make a new client)
9. `worker/worker/ai/tailor.py` — current tailoring logic (most relevant)
10. `worker/worker/config.py` — model name, OpenRouter base URL
11. `worker/worker/routes/jobs.py` — how the endpoint is called from web
12. `app/api/cron/run-campaigns/route.ts` — actual web-side trigger (NOT a `/generate` route)
13. `lib/worker-client.ts` — how web calls the worker

## Changes

### Change 1 — Constraint-based generation prompt

In `worker/worker/ai/resume.py` (and `tailor.py` if it has its own system prompt), **replace** the existing system prompt with this. Put the new prompt in a module constant `RESUME_SYSTEM_PROMPT_V2` so the old one can be kept as `RESUME_SYSTEM_PROMPT_V1` for rollback:

```python
RESUME_SYSTEM_PROMPT_V2 = """You are a senior career coach who has written 10,000+ resumes that landed interviews at FAANG, top consultancies, and Series-B-and-later startups. You write resume bullets that pass these rules without exception:

HARD RULES (failing any one means the bullet is rejected):
1. START with a strong action verb in past tense (or present tense for current roles). Approved verbs include: Led, Drove, Built, Shipped, Designed, Architected, Launched, Scaled, Reduced, Increased, Saved, Generated, Negotiated, Owned, Closed, Resolved, Automated, Migrated, Established, Delivered. NEVER start with "Responsible for", "Worked on", "Helped with", "Assisted", "Was tasked with", "Duties included".
2. INCLUDE at least ONE quantified outcome per bullet: a number, %, $, time-delta, scale, or count. Examples: "by 34%", "$1.2M ARR", "from 12s to 0.8s", "for 50K MAU", "across 4 teams". If you cannot quantify, you must EXPLICITLY mark the bullet with [NEEDS_METRIC] for human review — do not fabricate a number.
3. STRUCTURE = Action + Object + Result + (optional) Method. Example: "Reduced p95 checkout latency from 1.8s to 240ms by introducing Redis-backed session caching, increasing conversion 7%."
4. NEVER use clichés or filler: "team player", "results-driven", "synergize", "leverage", "go-getter", "wear many hats", "passionate about".
5. NEVER fabricate companies, titles, dates, tech stacks, or metrics that are not present in the source data. If source data is missing, return [INSUFFICIENT_DATA].
6. Keep each bullet to ONE LINE on standard letter-size, 11pt — roughly 95–135 characters.
7. Match the seniority of language to the role: don't write "Architected" for an intern role; don't write "Implemented bug fix" for a Director role.

OUTPUT FORMAT:
Return a JSON object matching this schema EXACTLY:
{
  "summary": "2–3 sentence executive summary, written in first person no pronouns.",
  "experience": [
    {
      "title": "...",
      "company": "...",
      "location": "...",
      "start_date": "YYYY-MM",
      "end_date": "YYYY-MM or 'Present'",
      "bullets": ["bullet 1", "bullet 2", ...]
    }
  ],
  "education": [...],
  "skills": {"languages": [...], "frameworks": [...], "tools": [...], "domains": [...]},
  "projects": [...]
}

If user input is too thin to follow these rules, return:
{"error": "INSUFFICIENT_DATA", "missing": ["specific field 1", ...]}
"""
```

### Change 2 — ATS keyword extraction step

Add a NEW function `extract_ats_keywords(job_description: str) -> list[str]` in `worker/worker/ai/keywords.py` (new file):

```python
"""ATS keyword extraction from job descriptions.

Single LLM call. Returns the keywords an ATS would weight most. Used by
tailor.py to ensure each appears verbatim at least once in the tailored resume.
"""
from typing import List
from .client import get_openai_client
from ..config import settings

KEYWORDS_PROMPT = """Extract the 15-25 keywords and key phrases from this job description that an ATS (Applicant Tracking System) would weight most heavily for matching. Include:
- Required skills (languages, frameworks, tools)
- Required certifications or degrees
- Domain-specific terminology
- Action capabilities the role requires ("design distributed systems", "manage P&L")
- Job title variants

Return ONLY a JSON array of strings. No prose. No markdown. Example:
["Python", "Kubernetes", "AWS", "design distributed systems", "B2B SaaS", ...]

Job description:
---
{job_description}
---"""

async def extract_ats_keywords(job_description: str) -> List[str]:
    client = get_openai_client()
    resp = await client.chat.completions.create(
        model=settings.model_name,
        temperature=0,
        messages=[
            {"role": "user", "content": KEYWORDS_PROMPT.format(job_description=job_description)}
        ],
        response_format={"type": "json_object"},
    )
    import json
    try:
        data = json.loads(resp.choices[0].message.content)
        if isinstance(data, list):
            return data
        # Some models wrap in {"keywords": [...]}
        for v in data.values():
            if isinstance(v, list):
                return v
        return []
    except Exception:
        return []
```

In `worker/worker/ai/tailor.py`, **modify** the tailoring flow:
1. Call `extract_ats_keywords(job_description)` FIRST
2. Pass the keyword list into the generation prompt as an additional system message: `"Ensure each of these keywords appears verbatim at least once in the output: <comma-separated list>. If a keyword does not fit naturally, place it in the Skills section."`
3. After generation, verify presence: compute set difference. If any keyword is missing, do ONE retry with the missing list highlighted. If still missing after retry, log a warning to Sentry and proceed.

### Change 3 — Self-critique pass

Add `critique_resume(resume_json: dict) -> dict` in `worker/worker/ai/critique.py` (new file):

```python
"""Self-critique pass over a generated resume. Rewrites failing bullets."""
from typing import Dict, Any
from .client import get_openai_client
from ..config import settings

CRITIQUE_PROMPT = """You are auditing a resume for quality. Apply this rubric to each bullet:

RUBRIC (each bullet scored pass/fail):
- A: Starts with strong action verb (not "Responsible for", "Worked on", "Helped")
- B: Contains at least one quantified outcome (%, $, time, count, scale)
- C: No clichés ("team player", "results-driven", "synergy", "leverage")
- D: One line, 95-135 characters
- E: Specific (mentions tech, scope, or context — not vague)

For each FAILING bullet, rewrite it to pass all 5 criteria. If the source data lacks the info needed to quantify, output the bullet with [NEEDS_METRIC] appended — do NOT fabricate.

Return JSON matching the input schema exactly, with failing bullets rewritten. Do not change passing bullets. Do not change non-bullet fields.

Input resume:
{resume_json}
"""

async def critique_resume(resume_json: Dict[str, Any]) -> Dict[str, Any]:
    import json
    client = get_openai_client()
    resp = await client.chat.completions.create(
        model=settings.model_name,
        temperature=0.2,
        messages=[
            {"role": "user", "content": CRITIQUE_PROMPT.format(resume_json=json.dumps(resume_json))}
        ],
        response_format={"type": "json_object"},
    )
    try:
        return json.loads(resp.choices[0].message.content)
    except Exception:
        return resume_json  # fall back to original on parse failure
```

Wire `critique_resume` into the pipeline AFTER generation in `tailor.py`. Pipeline becomes: `extract_keywords → generate → critique → return`.

### Change 4 — Feature flag

Wrap the new pipeline behind a flag so we can roll back instantly. In `worker/worker/config.py`:
```python
resume_quality_v2: bool = Field(default=False, alias="RESUME_QUALITY_V2")
```
In `tailor.py`, branch on `settings.resume_quality_v2`:
- `True` → new 3-step pipeline (keywords → generate v2 prompt → critique)
- `False` → old single-call pipeline (preserved)

Default OFF in code. Enable in prod env: `RESUME_QUALITY_V2=true` in `docker-compose.yml` for worker container.

### Change 5 — Tests

Add `worker/tests/test_resume_quality.py`:
- One test per hard rule (action verb, quantification, no clichés, length, no fabrication)
- Mock the OpenAI client; assert prompt content + that critique pass is called when flag is on
- Snapshot test on the full output schema

### Change 6 — Tracking

In `app/api/resumes/[id]/generate/route.ts` (or wherever the web-side trigger lives), emit an `AnalyticsEvent` with `event = "resume_generated"`, `properties = { template_id, used_v2: boolean, keywords_count, retries }`. This lets us measure quality v2 conversion lift vs v1 in §6.6 A/B tests later.

## Verification (before commit)
1. Run worker unit tests: `cd worker && pytest tests/test_resume_quality.py -v` — all pass
2. Run with flag OFF locally — verify old behavior intact (regression check)
3. Run with flag ON — verify all 5 rubric items pass on a sample input
4. Verify keyword coverage: on a sample JD with 20 keywords, ≥18 appear in output
5. Verify critique pass: feed a known-bad resume (lots of "Responsible for"), confirm rewrite happens

## Deploy
1. Commit on a branch `feat/resume-quality-v2`
2. PR → merge → CI deploys to GHCR
3. SSH to VPS, pull latest, `docker-compose up -d worker`
4. Verify worker logs: `docker-compose logs --tail=100 worker` — no startup errors
5. Set `RESUME_QUALITY_V2=true` in `/opt/resumeai/.env` and restart worker
6. Smoke test from production: generate one tailored resume via dashboard, confirm output quality
7. If anything looks wrong, immediately `RESUME_QUALITY_V2=false` and restart — instant rollback

## Rules
- Do NOT delete the V1 prompt or V1 pipeline. Keep both for at least 2 weeks for A/B and rollback.
- Do NOT change the web-side API contract. Worker output shape must stay identical.
- Do NOT introduce new external dependencies — use the existing OpenAI client.
- Do NOT change `lib/worker-client.ts` request/response — keep transport stable.
- Commit message: `feat(worker): resume quality v2 — STAR + ATS keywords + critique (behind RESUME_QUALITY_V2 flag)`

## Definition of done
- All three new files exist with full content
- Old prompt preserved as `RESUME_SYSTEM_PROMPT_V1`
- Feature flag works both ways in local testing
- Unit tests pass
- Deployed to VPS with flag ON
- Smoke test from prod shows quality improvement on a manually-selected resume
- An `AnalyticsEvent` row visible in DB after the smoke test
- VPS git HEAD matches GitHub main
- Strategic analysis doc updated: `docs/strategy/STRATEGIC_ANALYSIS.md` §2 — append a row to the "completed" section
