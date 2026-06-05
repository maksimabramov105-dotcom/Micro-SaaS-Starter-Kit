"""
jobfit.py — Job-fit scoring (0–100) for a candidate vs a job listing.

Phase 3: score every listing BEFORE queuing so we only auto-apply to good-fit
roles. The deterministic scorer is the always-on base (no LLM spend, fully
cacheable); an optional structured-LLM refinement (reusing _call_openai) can
nudge borderline scores and is capped per run by the caller.

Components (deterministic):
  - skills/keyword overlap (resume vs job title + description)   0–50
  - seniority match (title level vs resume signals)             0–20
  - eligibility (Phase 1 work-auth/remote)                      0–20
  - language overlap (candidate languages vs JD)                0–10

Returns {"score": int, "reasons": [str], "breakdown": {...}}.
"""
from __future__ import annotations

import re
from typing import Optional

from worker.autoapply import eligibility as _elig

# Very common words that should not count as "skill overlap".
_STOPWORDS = {
    "the", "and", "for", "you", "our", "with", "are", "this", "that", "will",
    "have", "your", "from", "all", "can", "who", "out", "job", "work", "team",
    "role", "experience", "years", "year", "skills", "ability", "strong",
    "looking", "join", "company", "we", "to", "of", "in", "a", "an", "as", "is",
    "on", "at", "or", "be", "by", "it", "we're", "you'll", "we", "us", "new",
    "help", "build", "working", "across", "within", "including", "such",
}

_SENIORITY = {
    "intern": 0, "junior": 1, "jr": 1, "associate": 1, "entry": 1,
    "mid": 2, "intermediate": 2,
    "senior": 3, "sr": 3, "lead": 4, "staff": 4, "principal": 5,
    "director": 6, "head": 6, "vp": 7, "chief": 8,
}


def _tokens(text: str) -> set[str]:
    words = re.findall(r"[a-zA-Z][a-zA-Z+#.]{1,}", (text or "").lower())
    return {w.strip(".") for w in words if w not in _STOPWORDS and len(w) > 2}


def _seniority_level(text: str) -> Optional[int]:
    t = (text or "").lower()
    best = None
    for kw, lvl in _SENIORITY.items():
        if re.search(rf"\b{re.escape(kw)}\b", t):
            best = lvl if best is None else max(best, lvl)
    return best


def score_job(
    resume_text: str,
    job: dict,
    eligibility: Optional[dict] = None,
    languages: Optional[list[str]] = None,
    job_country: str = "",
) -> dict:
    """Deterministic 0–100 fit score for one job. Pure + cacheable."""
    reasons: list[str] = []
    resume_tokens = _tokens(resume_text)
    jd_text = f"{job.get('title','')} {job.get('description','')}"
    jd_tokens = _tokens(jd_text)

    # ── skills/keyword overlap (0–50) ────────────────────────────────────────
    if jd_tokens:
        overlap = resume_tokens & jd_tokens
        ratio = len(overlap) / max(len(jd_tokens), 1)
        skills = min(50, round(ratio * 80))  # ~0.625 overlap → full marks
        if skills >= 30:
            reasons.append(f"strong skills overlap ({len(overlap)} terms)")
        elif skills >= 12:
            reasons.append(f"some skills overlap ({len(overlap)} terms)")
        else:
            reasons.append("weak skills overlap")
    else:
        skills = 25  # no JD text (e.g. Greenhouse content=false) → neutral
        reasons.append("no job description to match on (neutral)")

    # ── seniority match (0–20) ───────────────────────────────────────────────
    job_lvl = _seniority_level(job.get("title", ""))
    res_lvl = _seniority_level(resume_text)
    if job_lvl is None or res_lvl is None:
        seniority = 14
    else:
        gap = abs(job_lvl - res_lvl)
        seniority = max(0, 20 - gap * 7)
        if gap == 0:
            reasons.append("seniority matches")
        elif gap >= 2:
            reasons.append("seniority mismatch")

    # ── eligibility (0–20) ───────────────────────────────────────────────────
    is_remote = bool(job.get("remote")) or "remote" in (job.get("location", "") or "").lower()
    knockout = _elig.knockout_reason(eligibility, job_country, is_remote)
    if knockout:
        eligible = 0
        reasons.append(f"eligibility risk ({knockout})")
    else:
        eligible = 20
        if is_remote:
            reasons.append("remote — best eligibility")

    # ── language overlap (0–10) ──────────────────────────────────────────────
    langs = [l.lower() for l in (languages or [])]
    language = 10
    if langs and jd_tokens:
        # If JD explicitly requires a language the candidate lacks, dock points.
        known_langs = {"english", "german", "french", "spanish", "dutch", "italian", "portuguese", "polish"}
        required = {w for w in jd_tokens if w in known_langs}
        missing = required - set(langs)
        if missing:
            language = 4
            reasons.append(f"requires language(s) not listed: {', '.join(sorted(missing))}")

    score = int(min(100, skills + seniority + eligible + language))
    return {
        "score": score,
        "reasons": reasons,
        "breakdown": {
            "skills": skills, "seniority": seniority,
            "eligibility": eligible, "language": language,
        },
    }
