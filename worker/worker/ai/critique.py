"""
critique.py — Self-critique pass over a generated resume JSON.

Second LLM call that audits every experience bullet against a 5-point
quality rubric (STAR/CAR) and rewrites failing bullets in-place.
On parse failure or API error, returns the original resume unchanged
(non-destructive — never loses data).

Reuses _call_openai from resume.py per corrections doc §3.1.
"""
import asyncio
import json
from typing import Any, Dict

import structlog

from worker.ai.resume import _call_openai
from worker.config import settings

logger = structlog.get_logger(__name__)

_CRITIQUE_SYSTEM = """You are a senior resume quality auditor. Apply this 5-point rubric to each experience bullet:

A: Starts with a strong action verb (Led, Built, Drove, Shipped, Reduced, Launched, Designed, Architected, Scaled, Increased, Negotiated, Closed, Automated, Migrated, Delivered…). NEVER starts with "Responsible for", "Worked on", "Helped", "Assisted".
B: Contains at least one quantified outcome (%, $, time, count, scale). If source data cannot support quantification, append [NEEDS_METRIC] — do NOT fabricate.
C: No clichés: "team player", "results-driven", "synergy", "leverage", "passionate about".
D: Single line, approximately 95–135 characters at 11pt.
E: Specific — mentions technology, scope, or measurable context. Not vague filler.

For each FAILING bullet, rewrite it to pass all 5 criteria.
For each PASSING bullet, return it unchanged.
Do not change non-bullet fields (summary, company names, dates, education, skills lists).
Return JSON matching the exact input schema. No markdown, no explanation."""

_CRITIQUE_PROMPT = """Audit and rewrite failing bullets in this resume JSON.

Resume:
{resume_json}

Return the corrected resume JSON only. No markdown, no explanation."""


async def critique_resume(
    resume_json: Dict[str, Any],
    api_key: str = "",
) -> Dict[str, Any]:
    """
    Run a self-critique pass over a generated resume dict.

    Rewrites bullets failing the STAR/CAR rubric. Non-destructive:
    returns the original dict on any error so the pipeline always has output.
    """
    prompt = _CRITIQUE_PROMPT.format(
        resume_json=json.dumps(resume_json, ensure_ascii=False)[:4000]
    )

    try:
        raw = await asyncio.wait_for(
            _call_openai(
                prompt=prompt,
                system=_CRITIQUE_SYSTEM,
                api_key=api_key or settings.openai_api_key,
                max_tokens=2500,
            ),
            timeout=60,
        )
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        critiqued: Dict[str, Any] = json.loads(raw)
        logger.info("critique_resume.done", top_keys=list(critiqued.keys()))
        return critiqued

    except asyncio.TimeoutError:
        logger.warning("critique_resume.timeout")
        return resume_json
    except json.JSONDecodeError as exc:
        logger.warning("critique_resume.parse_failed", error=str(exc))
        return resume_json
    except Exception as exc:
        logger.warning("critique_resume.error", error=str(exc))
        return resume_json
