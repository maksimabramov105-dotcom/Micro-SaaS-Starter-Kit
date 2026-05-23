"""
keywords.py — ATS keyword extraction from job descriptions.

Single LLM call. Returns keywords an ATS would weight most heavily for
matching against a tailored resume. Used by tailor.py v2 pipeline.

Reuses _call_openai from resume.py (same httpx client, no new dependency).
Per corrections doc §3.1: worker/worker/ai/ has no client.py — reuse _call_openai.
"""
import asyncio
import json
from typing import List

import structlog

from worker.ai.resume import _call_openai
from worker.config import settings

logger = structlog.get_logger(__name__)

_KEYWORDS_SYSTEM = (
    "You are an ATS (Applicant Tracking System) specialist. "
    "Extract exactly the keywords and phrases that matter most for resume matching. "
    "Output only a JSON array of strings. No prose, no markdown fences."
)

_KEYWORDS_PROMPT = """Extract the 15-25 most ATS-significant keywords and key phrases from this job description. Include:
- Required technical skills (languages, frameworks, platforms, tools)
- Required certifications or degrees
- Domain-specific terminology (e.g. "B2B SaaS", "distributed systems")
- Action capabilities the role requires (e.g. "design APIs", "manage P&L")
- Common job title variants for this role

Return ONLY a JSON array of strings. Example:
["Python", "Kubernetes", "AWS", "REST APIs", "B2B SaaS", "distributed systems"]

Job description:
---
{job_description}
---"""


async def extract_ats_keywords(
    job_description: str,
    api_key: str = "",
) -> List[str]:
    """
    Extract ATS-significant keywords from a job description.

    Returns a list of strings (15–25 items typical).
    On parse failure or API error, returns [] — callers must handle gracefully.
    """
    if not job_description.strip():
        return []

    prompt = _KEYWORDS_PROMPT.format(job_description=job_description[:3000])

    try:
        raw = await asyncio.wait_for(
            _call_openai(
                prompt=prompt,
                system=_KEYWORDS_SYSTEM,
                api_key=api_key or settings.openai_api_key,
                max_tokens=300,
            ),
            timeout=20,
        )
        # Strip markdown fences if model wrapped the output
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        data = json.loads(raw)

        # Handle both bare array and {"keywords": [...]} wrapper some models emit
        if isinstance(data, list):
            return [str(k) for k in data if k]
        for v in data.values():
            if isinstance(v, list):
                return [str(k) for k in v if k]

        logger.warning("keywords.unexpected_shape", shape=type(data).__name__)
        return []

    except asyncio.TimeoutError:
        logger.warning("keywords.timeout")
        return []
    except json.JSONDecodeError as exc:
        logger.warning("keywords.parse_failed", error=str(exc))
        return []
    except Exception as exc:
        logger.warning("keywords.error", error=str(exc))
        return []
