"""
parse.py — turn an existing resume's plain text into structured profile fields.

This is the activation step (P4.1). Before it, creating a resume meant typing a
four-step form from scratch: contact details, every job, every bullet, education,
skills. That is fifteen minutes of data entry standing between signup and the
first tangible artifact, and most people quit somewhere in the middle of it.
After it, the user pastes the resume they already have and reviews a prefilled
form.

Single LLM call, same httpx client as every other module here.

TWO RULES THIS PROMPT ENFORCES, because both failure modes are worse than an
empty field:

  1. Never invent. If a date, a school, or a phone number is not in the text, the
     field comes back empty. A resume the user did not write is a resume that
     gets them caught in an interview.
  2. Bullets are copied, not rewritten. Tailoring is a separate, explicit,
     paid-for step. Silently "improving" someone's history during an import is
     both dishonest and impossible to review, since the user has no diff.

Returns a dict shaped exactly like the /dashboard/resumes/new form, so the client
can hand it straight to react-hook-form's reset(). On any failure it returns
None: the caller falls back to the empty form, which is the pre-P4.1 behaviour
and therefore never a regression.
"""
import asyncio
import json
from typing import Any, Dict, List, Optional

import structlog

from worker.ai.resume import _call_openai
from worker.config import settings

logger = structlog.get_logger(__name__)

# Guardrails on what we will accept back. A model that goes off the rails tends
# to do it by producing a hundred jobs or a thousand skills.
MAX_WORK = 8
MAX_BULLETS = 8
MAX_EDU = 5
MAX_SKILLS = 25
MAX_INPUT_CHARS = 12000

_SYSTEM = (
    "You extract structured data from resumes. You copy what is written; you "
    "never invent, embellish, infer, or rewrite. Missing information is returned "
    "as an empty string. Output only JSON — no prose, no markdown fences."
)

_PROMPT = """Extract this resume into JSON with exactly these keys:

{{
  "fullName": "",
  "email": "",
  "phone": "",
  "linkedin": "",
  "targetRole": "",
  "yearsExp": 0,
  "location": "",
  "workHistory": [
    {{"company": "", "role": "", "startDate": "", "endDate": "", "bullets": [""]}}
  ],
  "education": [{{"school": "", "degree": "", "year": ""}}],
  "skills": [""]
}}

Rules:
- Copy values verbatim from the resume. Do NOT invent anything. If a field is not
  present in the text, return "" (or 0 for yearsExp, or [] for a list).
- Do NOT rewrite, shorten, or improve the bullet points. Copy them as written,
  minus any leading bullet character.
- startDate/endDate: use "MMM YYYY" if the resume gives a month, otherwise "YYYY".
  For a job the person still holds, endDate must be "Present".
- targetRole: the person's current or most recent job title. Do not guess a role
  they have never held.
- yearsExp: total years of professional experience, computed only from the dates
  actually listed. If the dates do not support a number, return 0.
- Most recent job first.
- skills: only concrete skills, tools, languages and technologies that appear in
  the resume. Not soft-skill filler.

Resume:
---
{resume_text}
---"""


def _s(value: Any, limit: int = 200) -> str:
    """Coerce to a trimmed string. Models occasionally emit null or a number."""
    if value is None or isinstance(value, (list, dict, bool)):
        return ""
    return str(value).strip()[:limit]


def _clean_work(raw: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not isinstance(raw, list):
        return out
    for item in raw[:MAX_WORK]:
        if not isinstance(item, dict):
            continue
        company = _s(item.get("company"), 120)
        role = _s(item.get("role"), 120)
        # An entry with neither a company nor a role is noise, not a job.
        if not company and not role:
            continue
        bullets_raw = item.get("bullets")
        bullets = [
            _s(b, 500).lstrip("•-–* ").strip()
            for b in (bullets_raw if isinstance(bullets_raw, list) else [])
        ]
        bullets = [b for b in bullets if b][:MAX_BULLETS]
        out.append(
            {
                "company": company,
                "role": role,
                "startDate": _s(item.get("startDate"), 30),
                "endDate": _s(item.get("endDate"), 30),
                # The form renders one input per bullet; an empty list would
                # give the user nothing to type into.
                "bullets": bullets or [""],
            }
        )
    return out


def _clean_education(raw: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if not isinstance(raw, list):
        return out
    for item in raw[:MAX_EDU]:
        if not isinstance(item, dict):
            continue
        school = _s(item.get("school"), 120)
        degree = _s(item.get("degree"), 120)
        if not school and not degree:
            continue
        out.append({"school": school, "degree": degree, "year": _s(item.get("year"), 20)})
    return out


def _clean_skills(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    out: List[str] = []
    for s in raw:
        v = _s(s, 60)
        key = v.lower()
        if not v or key in seen:
            continue
        seen.add(key)
        out.append(v)
        if len(out) >= MAX_SKILLS:
            break
    return out


def _years(value: Any) -> int:
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return 0
    # 60 years of professional experience is a parse error, not a career.
    return n if 0 <= n <= 60 else 0


def normalise(data: Any) -> Optional[Dict[str, Any]]:
    """
    Coerce a model response into the form's shape, or None if it is unusable.

    Split out from the network call so it is testable without an API key — this
    is where every realistic failure lives.
    """
    if not isinstance(data, dict):
        return None

    parsed = {
        "fullName": _s(data.get("fullName"), 120),
        "email": _s(data.get("email"), 200),
        "phone": _s(data.get("phone"), 40),
        "linkedin": _s(data.get("linkedin"), 200),
        "targetRole": _s(data.get("targetRole"), 120),
        "yearsExp": _years(data.get("yearsExp")),
        "location": _s(data.get("location"), 120),
        "workHistory": _clean_work(data.get("workHistory")),
        "education": _clean_education(data.get("education")),
        "skills": _clean_skills(data.get("skills")),
    }

    # A response with no name, no role and no jobs did not parse a resume. Better
    # to say so and show the empty form than to prefill three blank inputs and
    # claim it worked.
    if not parsed["fullName"] and not parsed["targetRole"] and not parsed["workHistory"]:
        return None

    return parsed


async def parse_resume_text(
    resume_text: str,
    api_key: str = "",
) -> Optional[Dict[str, Any]]:
    """
    Parse resume text into structured profile fields.

    Returns None on empty input, timeout, bad JSON, or an unusable result — the
    caller must fall back to an empty form rather than surfacing an error.
    """
    text = (resume_text or "").strip()
    if len(text) < 100:
        return None

    prompt = _PROMPT.format(resume_text=text[:MAX_INPUT_CHARS])

    try:
        raw = await asyncio.wait_for(
            _call_openai(
                prompt=prompt,
                system=_SYSTEM,
                api_key=api_key or settings.openai_api_key,
                max_tokens=2000,
            ),
            timeout=45,
        )
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        result = normalise(json.loads(raw))
        if result is None:
            logger.warning("parse_resume.unusable_result")
            return None

        logger.info(
            "parse_resume.done",
            jobs=len(result["workHistory"]),
            skills=len(result["skills"]),
        )
        return result

    except asyncio.TimeoutError:
        logger.warning("parse_resume.timeout")
        return None
    except json.JSONDecodeError as exc:
        logger.warning("parse_resume.bad_json", error=str(exc))
        return None
    except Exception as exc:
        logger.warning("parse_resume.error", error=str(exc))
        return None
