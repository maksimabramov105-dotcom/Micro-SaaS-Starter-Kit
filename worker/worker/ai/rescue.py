"""
rescue.py — the "AI Resume Rescue" tripwire bundle (Revenue Sprint A2).

One call produces everything the $4.99 buyer receives:
  - tailored_resume: their resume rewritten for ONE specific job
    (reuses tailor_resume, which already caches + self-critiques on V2)
  - fit_report: deterministic score breakdown from jobfit.score_job,
    ATS keywords present/missing, seniority note, and concrete fixes

The whole bundle is cached in Redis keyed by (resume_text, job) so a repeat
generation for the same inputs never pays OpenAI twice (cost guard: the
web app allows max 1 regeneration, and even that hits this cache).
"""
import hashlib

import structlog

from worker.ai import jobfit
from worker.ai.keywords import extract_ats_keywords
from worker.ai.tailor import _get_cached, _set_cached, tailor_resume

logger = structlog.get_logger(__name__)


def _job_hash(job: dict) -> str:
    raw = f"{job.get('title','')}|{job.get('company','')}|{job.get('description','')}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _bundle_cache_key(resume_text: str, job: dict) -> str:
    resume_hash = hashlib.sha256(resume_text.encode()).hexdigest()
    return f"rescue:{resume_hash[:32]}:{_job_hash(job)[:32]}"


def _tokens_in(text: str) -> set[str]:
    return jobfit._tokens(text)


def _keyword_present(keyword: str, resume_tokens: set[str], resume_lower: str) -> bool:
    # Multi-word keywords ("distributed systems") are checked as substrings;
    # single words via the token set so "Java" doesn't match "JavaScript".
    kw = keyword.lower().strip()
    if " " in kw:
        return kw in resume_lower
    return kw in resume_tokens


async def build_rescue_bundle(resume_text: str, job: dict) -> dict:
    """
    Returns {tailored_resume, fit_report, tokens_used, cached}.
    Raises on unrecoverable generation failure (caller refunds).
    """
    cache_key = _bundle_cache_key(resume_text, job)
    cached = await _get_cached(cache_key)
    if cached is not None:
        logger.info("rescue.cache_hit", key=cache_key[:24])
        return {**cached, "cached": True}

    # 1. Deterministic fit score (free, pure)
    score = jobfit.score_job(resume_text=resume_text, job=job)

    # 2. ATS keywords -> present / missing split (one small LLM call, [] on error)
    keywords = await extract_ats_keywords(job.get("description", ""))
    resume_tokens = _tokens_in(resume_text)
    resume_lower = resume_text.lower()
    present = [k for k in keywords if _keyword_present(k, resume_tokens, resume_lower)]
    missing = [k for k in keywords if k not in present]

    # 3. Tailored resume (the main LLM call; has its own (resume, job) cache)
    base_resume = {"resume_text": resume_text[:6000]}
    tailored, tokens_used, model = await tailor_resume(
        base_resume=base_resume,
        job=job,
        job_id=_job_hash(job)[:24],
    )
    # tailor_resume falls back to returning base_resume on failure — for a paid
    # product that is NOT acceptable output, so treat it as a hard failure.
    if tailored == base_resume:
        raise RuntimeError("tailoring produced no output (LLM failure)")

    # 4. Concrete fixes — deterministic, explainable, no extra LLM spend
    fixes: list[str] = []
    if missing:
        fixes.append(
            "Add these terms where they are truthfully applicable: "
            + ", ".join(missing[:8])
        )
    for reason in score.get("reasons", []):
        if "seniority mismatch" in reason:
            fixes.append(
                "The role's seniority level differs from how your resume reads — "
                "align your title/summary wording with the level you are targeting."
            )
        if "weak skills overlap" in reason:
            fixes.append(
                "Lead your summary and first bullets with the skills this job "
                "actually asks for — recruiters scan the top third first."
            )
    if not fixes:
        fixes.append(
            "Strong baseline match — submit the tailored version and mirror the "
            "job's exact phrasing for your top 3 skills."
        )

    fit_report = {
        "score": score.get("score"),
        "breakdown": score.get("breakdown", {}),
        "reasons": score.get("reasons", []),
        "keywords_present": present[:15],
        "keywords_missing": missing[:15],
        "fixes": fixes,
        "model": model,
    }

    result = {
        "tailored_resume": tailored,
        "fit_report": fit_report,
        "tokens_used": tokens_used,
    }
    await _set_cached(cache_key, result)
    logger.info(
        "rescue.bundle_done",
        score=fit_report["score"],
        missing=len(missing),
        tokens=tokens_used,
    )
    return {**result, "cached": False}
