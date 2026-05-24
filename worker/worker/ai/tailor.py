"""
tailor.py — Per-application AI tailoring of resume JSON + cover letter.

Both functions follow a consistent interface:
    tailor_resume(base_resume, job, api_key, job_id) -> (dict, int, str)
    tailor_cover_letter(base_resume, job, api_key, job_id) -> (str, int, str)
Return tuples are (result, approx_tokens_used, model_name).

Caching:
    Results are cached in-process by sha256(resume_json + job_id) for 7 days.
    This prevents double-spending on retries of the same job.

Plan-tier gating (should_tailor):
    Free     → never tailor (caller passes plan_tier from DB)
    Trial    → tailor every 3rd application only
    Pro/Unlimited → always tailor

Cost:
    gpt-4o-mini is used for all tailoring (~$0.01-0.05 per application pair).
"""
import asyncio
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import redis.asyncio as aioredis
import structlog

from worker.ai.resume import _call_openai
from worker.ai.keywords import extract_ats_keywords
from worker.ai.critique import critique_resume
from worker.config import settings

logger = structlog.get_logger(__name__)

# ── Model ─────────────────────────────────────────────────────────────────────
TAILOR_MODEL = "gpt-4o-mini"

# ── Prompt templates loaded once at import time ────────────────────────────────
_PROMPTS_DIR = Path(__file__).parent / "prompts"

# V1 templates (preserved for rollback / A/B)
_RESUME_TEMPLATE: str = (
    (_PROMPTS_DIR / "tailor_resume.txt").read_text(encoding="utf-8").strip()
)
_COVER_TEMPLATE: str = (
    (_PROMPTS_DIR / "tailor_cover_letter.txt").read_text(encoding="utf-8").strip()
)

# V2 templates — STAR/CAR + ATS keyword injection
# System prompt (STAR/CAR constraints) shared with resume.py
from worker.ai.resume import _RESUME_SYSTEM_PROMPT_V2 as _TAILOR_SYSTEM_V2  # noqa: E402
_RESUME_TEMPLATE_V2: str = (
    (_PROMPTS_DIR / "tailor_resume_v2.txt").read_text(encoding="utf-8").strip()
)
_COVER_TEMPLATE_V2: str = (
    (_PROMPTS_DIR / "tailor_cover_letter_v2.txt").read_text(encoding="utf-8").strip()
)

# ── Tailor result cache (Redis DB 2 + local fast-path) ────────────────────────
# Redis key prefix: "tailor:{sha256_key}"
# Redis DB 2 is dedicated to tailor results, separate from the job store (DB 0).
# TTL: 7 days — same as the old in-memory TTL.
# Local dict is a fast-path for same-restart, same-process hits (avoids a round-
# trip to Redis for the common case where the worker hasn't restarted).

_CACHE: dict[str, tuple[Any, float]] = {}  # fast-path: {key: (value, timestamp)}
_CACHE_TTL = 7 * 24 * 3600                 # 7 days in seconds
_LOCAL_TTL = 3600                           # 1 hour — local fast-path eviction


def _tailor_redis_url() -> str:
    """Return a Redis DB 2 URL derived from settings.redis_url, or empty string."""
    url = settings.redis_url
    if not url:
        return ""
    # Strip existing /db suffix if present (e.g. redis://host:6379/1 → /2)
    parts = url.rstrip("/").rsplit("/", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return f"{parts[0]}/2"
    return f"{url}/2"


def _cache_key(base_resume: dict, job_id: str, suffix: str) -> str:
    """Stable 64-char hex key for (resume, job_id, suffix)."""
    data = json.dumps(base_resume, sort_keys=True, ensure_ascii=False) + job_id + suffix
    return hashlib.sha256(data.encode()).hexdigest()


async def _get_cached(key: str) -> Any | None:
    """Check local fast-path first, then Redis. Returns None on miss."""
    # 1. Local fast-path (no I/O)
    entry = _CACHE.get(key)
    if entry is not None:
        value, ts = entry
        if time.time() - ts < _LOCAL_TTL:
            return value
        del _CACHE[key]

    # 2. Redis fallback (survives restarts)
    redis_url = _tailor_redis_url()
    if not redis_url:
        return None
    try:
        async with aioredis.from_url(redis_url, decode_responses=True) as r:
            data = await r.get(f"tailor:{key}")
        if data:
            value = json.loads(data)
            _CACHE[key] = (value, time.time())  # warm local fast-path
            return value
    except Exception as exc:
        logger.warning("tailor_cache.redis_read_failed", key=key[:16], error=str(exc))
    return None


async def _set_cached(key: str, value: Any) -> None:
    """Write to local fast-path and Redis DB 2 (fire-and-forget on Redis error)."""
    _CACHE[key] = (value, time.time())

    redis_url = _tailor_redis_url()
    if not redis_url:
        return
    try:
        async with aioredis.from_url(redis_url, decode_responses=True) as r:
            await r.setex(f"tailor:{key}", _CACHE_TTL, json.dumps(value))
    except Exception as exc:
        logger.warning("tailor_cache.redis_write_failed", key=key[:16], error=str(exc))


# ── Plan-tier gating ───────────────────────────────────────────────────────────

def should_tailor(plan_tier: str, application_count: int = 0) -> bool:
    """
    Return True if tailoring should run for this user / application.

    plan_tier: "free" | "trial" | "pro" | "unlimited" (case-insensitive)
    application_count: 0-indexed count of applications sent this session
                       (used for trial throttling)
    """
    tier = plan_tier.lower()
    if tier == "free":
        return False
    if tier == "trial":
        return (application_count % 3) == 0
    # pro, unlimited, or any unrecognised paid tier → always tailor
    return True


# ── V2 internal pipeline ──────────────────────────────────────────────────────

async def _tailor_resume_v2(
    base_resume: dict,
    job: dict,
    api_key: str,
    job_id: str,
) -> tuple[dict, int, str]:
    """
    V2 pipeline: extract keywords → generate (STAR/CAR) → verify coverage → critique.

    Called only when settings.resume_quality_v2 is True.
    Always returns a valid (dict, int, str) — errors bubble up to tailor_resume.
    """
    description = (job.get("description") or "")

    # Step 1: Extract ATS keywords from job description
    keywords = await extract_ats_keywords(description, api_key)
    keywords_str = ", ".join(keywords) if keywords else "(none extracted)"
    logger.info("tailor_resume_v2.keywords", job_id=job_id, count=len(keywords))

    # Step 2: Build user prompt with keywords injected
    base_json = json.dumps(base_resume, ensure_ascii=False)[:3500]
    prompt = (
        _RESUME_TEMPLATE_V2
        .replace("{base_resume}", base_json)
        .replace("{job_title}", job.get("title", ""))
        .replace("{company}", job.get("company", ""))
        .replace("{description}", description[:2000])
        .replace("{ats_keywords}", keywords_str)
    )

    # Step 3: Generate with STAR/CAR system prompt
    raw = await asyncio.wait_for(
        _call_openai(
            prompt=prompt,
            system=_TAILOR_SYSTEM_V2,
            api_key=api_key or settings.openai_api_key,
            model=TAILOR_MODEL,
            max_tokens=2500,
        ),
        timeout=60,
    )
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    # Step 4: Verify keyword coverage — one retry if >50% of keywords are missing
    if keywords:
        raw_lower = raw.lower()
        missing = [kw for kw in keywords if kw.lower() not in raw_lower]
        if len(missing) > len(keywords) // 2:
            logger.info(
                "tailor_resume_v2.keyword_retry",
                job_id=job_id,
                missing_count=len(missing),
            )
            retry_prompt = (
                prompt
                + "\n\nCRITICAL — these keywords MUST appear verbatim at least once "
                  "(add to Skills section if they don't fit elsewhere): "
                + ", ".join(missing)
            )
            try:
                raw = await asyncio.wait_for(
                    _call_openai(
                        prompt=retry_prompt,
                        system=_TAILOR_SYSTEM_V2,
                        api_key=api_key or settings.openai_api_key,
                        model=TAILOR_MODEL,
                        max_tokens=2500,
                    ),
                    timeout=60,
                )
                raw = raw.strip()
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            except Exception as exc:
                logger.warning("tailor_resume_v2.retry_failed", job_id=job_id, error=str(exc))

    # Step 5: Parse JSON
    tailored: dict = json.loads(raw)
    tokens = max(1, int(len(raw.split()) * 0.75))

    # Step 6: Self-critique pass — rewrites bullets failing STAR/CAR rubric
    critiqued = await critique_resume(tailored, api_key or settings.openai_api_key)
    logger.info("tailor_resume_v2.done", job_id=job_id, tokens=tokens)
    return critiqued, tokens, TAILOR_MODEL


# ── Core tailoring functions ───────────────────────────────────────────────────

async def tailor_resume(
    base_resume: dict,
    job: dict,
    api_key: str = "",
    job_id: str = "",
) -> tuple[dict, int, str]:
    """
    Tailor a resume JSON dict for a specific job.

    Args:
        base_resume: The user's stored resume (Resume.generated JSON shape).
        job:         Dict with keys: title, company, description.
        api_key:     OpenAI key (falls back to settings.openai_api_key).
        job_id:      Stable external ID for cache keying (e.g. JobListing.id).

    Returns:
        (tailored_resume_dict, tokens_used_approx, model_name)
        On failure: (base_resume, 0, TAILOR_MODEL) — always non-destructive.
    """
    # V2 pipeline — STAR/CAR + ATS keywords + self-critique
    if settings.resume_quality_v2:
        key_v2 = _cache_key(base_resume, job_id, "resume_v2")
        cached_v2 = await _get_cached(key_v2)
        if cached_v2 is not None:
            logger.info("tailor_resume.cache_hit_v2", job_id=job_id)
            return cached_v2
        try:
            result_v2 = await _tailor_resume_v2(base_resume, job, api_key, job_id)
            await _set_cached(key_v2, result_v2)
            return result_v2
        except json.JSONDecodeError as exc:
            logger.warning("tailor_resume_v2.json_error", job_id=job_id, error=str(exc))
        except asyncio.TimeoutError:
            logger.warning("tailor_resume_v2.timeout", job_id=job_id)
        except Exception as exc:
            logger.warning("tailor_resume_v2.error", job_id=job_id, error=str(exc))
        # Non-destructive fallback to V1 if V2 fails
        logger.warning("tailor_resume_v2.fallback_to_v1", job_id=job_id)

    key = _cache_key(base_resume, job_id, "resume")
    cached = await _get_cached(key)
    if cached is not None:
        logger.info("tailor_resume.cache_hit", job_id=job_id)
        return cached

    base_json = json.dumps(base_resume, ensure_ascii=False)[:3000]
    description = (job.get("description") or "")[:2000]

    prompt = (
        _RESUME_TEMPLATE
        .replace("{base_resume}", base_json)
        .replace("{job_title}", job.get("title", ""))
        .replace("{company}", job.get("company", ""))
        .replace("{description}", description)
    )

    logger.info(
        "tailor_resume.started",
        job_id=job_id,
        company=job.get("company"),
        job_title=job.get("title"),
    )
    try:
        raw = await asyncio.wait_for(
            _call_openai(
                prompt=prompt,
                system="You are an expert resume writer. Output only valid JSON — no markdown, no explanation.",
                api_key=api_key or settings.openai_api_key,
                model=TAILOR_MODEL,
                max_tokens=2000,
            ),
            timeout=60,
        )
        # Strip markdown fences if the model wrapped the output
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        tailored: dict = json.loads(raw)
        # Approximate token usage: ~0.75 tokens per word
        tokens = max(1, int(len(raw.split()) * 0.75))
        result: tuple[dict, int, str] = (tailored, tokens, TAILOR_MODEL)
        await _set_cached(key, result)
        logger.info("tailor_resume.done", job_id=job_id, tokens=tokens)
        return result

    except json.JSONDecodeError as exc:
        logger.warning("tailor_resume.json_error", job_id=job_id, error=str(exc))
    except asyncio.TimeoutError:
        logger.warning("tailor_resume.timeout", job_id=job_id)
    except Exception as exc:
        logger.warning("tailor_resume.error", job_id=job_id, error=str(exc))

    # Non-destructive fallback — caller uses base resume unchanged
    return base_resume, 0, TAILOR_MODEL


async def tailor_cover_letter(
    base_resume: dict,
    job: dict,
    api_key: str = "",
    job_id: str = "",
) -> tuple[str, int, str]:
    """
    Generate a per-job cover letter from the candidate's resume JSON.

    Args:
        base_resume: The user's stored resume (Resume.generated JSON shape).
        job:         Dict with keys: title, company, description.
        api_key:     OpenAI key (falls back to settings.openai_api_key).
        job_id:      Stable external ID for cache keying.

    Returns:
        (cover_letter_text, tokens_used_approx, model_name)
        On failure: ("", 0, TAILOR_MODEL) — caller uses generic fallback.
    """
    # V2 pipeline — ATS-keyword-enriched cover letter
    if settings.resume_quality_v2:
        key_v2 = _cache_key(base_resume, job_id, "cover_v2")
        cached_v2 = await _get_cached(key_v2)
        if cached_v2 is not None:
            logger.info("tailor_cover_letter.cache_hit_v2", job_id=job_id)
            return cached_v2
        try:
            description_v2 = (job.get("description") or "")
            keywords = await extract_ats_keywords(description_v2, api_key or settings.openai_api_key)
            keywords_str = ", ".join(keywords) if keywords else "(none extracted)"
            logger.info("tailor_cover_letter_v2.keywords", job_id=job_id, count=len(keywords))

            base_json_v2 = json.dumps(base_resume, ensure_ascii=False)[:2000]
            prompt_v2 = (
                _COVER_TEMPLATE_V2
                .replace("{base_resume}", base_json_v2)
                .replace("{job_title}", job.get("title", ""))
                .replace("{company}", job.get("company", ""))
                .replace("{description}", description_v2[:2000])
                .replace("{ats_keywords}", keywords_str)
            )
            text_v2 = await asyncio.wait_for(
                _call_openai(
                    prompt=prompt_v2,
                    system=_TAILOR_SYSTEM_V2,
                    api_key=api_key or settings.openai_api_key,
                    model=TAILOR_MODEL,
                    max_tokens=600,
                ),
                timeout=45,
            )
            text_v2 = text_v2.strip()
            tokens_v2 = max(1, int(len(text_v2.split()) * 0.75))
            result_v2: tuple[str, int, str] = (text_v2, tokens_v2, TAILOR_MODEL)
            await _set_cached(key_v2, result_v2)
            logger.info("tailor_cover_letter_v2.done", job_id=job_id, length=len(text_v2))
            return result_v2
        except asyncio.TimeoutError:
            logger.warning("tailor_cover_letter_v2.timeout", job_id=job_id)
        except Exception as exc:
            logger.warning("tailor_cover_letter_v2.error", job_id=job_id, error=str(exc))
        # Non-destructive fallback to V1 if V2 fails
        logger.warning("tailor_cover_letter_v2.fallback_to_v1", job_id=job_id)

    key = _cache_key(base_resume, job_id, "cover")
    cached = await _get_cached(key)
    if cached is not None:
        logger.info("tailor_cover_letter.cache_hit", job_id=job_id)
        return cached

    base_json = json.dumps(base_resume, ensure_ascii=False)[:2000]
    description = (job.get("description") or "")[:2000]

    prompt = (
        _COVER_TEMPLATE
        .replace("{base_resume}", base_json)
        .replace("{job_title}", job.get("title", ""))
        .replace("{company}", job.get("company", ""))
        .replace("{description}", description)
    )

    logger.info(
        "tailor_cover_letter.started",
        job_id=job_id,
        company=job.get("company"),
    )
    try:
        text = await asyncio.wait_for(
            _call_openai(
                prompt=prompt,
                system="You are an expert cover letter writer. Output only the letter body — plain text, no markdown.",
                api_key=api_key or settings.openai_api_key,
                model=TAILOR_MODEL,
                max_tokens=600,
            ),
            timeout=45,
        )
        text = text.strip()
        tokens = max(1, int(len(text.split()) * 0.75))
        result: tuple[str, int, str] = (text, tokens, TAILOR_MODEL)
        await _set_cached(key, result)
        logger.info("tailor_cover_letter.done", job_id=job_id, length=len(text))
        return result

    except asyncio.TimeoutError:
        logger.warning("tailor_cover_letter.timeout", job_id=job_id)
    except Exception as exc:
        logger.warning("tailor_cover_letter.error", job_id=job_id, error=str(exc))

    return "", 0, TAILOR_MODEL
