"""
test_resume_quality.py — Tests for Resume Quality v2 pipeline.

Covers:
  - ATS keyword extraction (keywords.py)
  - Self-critique pass (critique.py)
  - V2 tailor_resume pipeline end-to-end
  - V2 tailor_cover_letter pipeline
  - Feature flag gating (V2 off → V1 used, V2 on → V2 path used)
  - Keyword coverage retry trigger
  - Output schema stability (V2 output has same top-level keys as input)
  - 5 STAR/CAR hard-rule checks (via critique prompt system content)
  - Non-destructive fallback on every failure mode

All OpenAI calls are mocked — no real API key required.
"""
import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest

from worker.ai.keywords import extract_ats_keywords
from worker.ai.critique import critique_resume
from worker.ai.tailor import (
    TAILOR_MODEL,
    tailor_resume,
    tailor_cover_letter,
)

# ── Shared fixtures ────────────────────────────────────────────────────────────

BASE_RESUME = {
    "summary": "Backend engineer with 5 years in Python and distributed systems.",
    "experience": [
        {
            "company": "Acme Corp",
            "title": "Senior Engineer",
            "years": "2021-2024",
            "bullets": [
                "Responsible for API work",           # fails rule A (weak verb)
                "Helped with Kubernetes migration",   # fails rule A (helped)
                "Reduced API latency by 40% for 50M+ daily requests using async batching",  # PASSES
            ],
        }
    ],
    "skills": ["Python", "Kubernetes", "PostgreSQL", "FastAPI"],
    "education": [{"degree": "BSc Computer Science", "school": "MIT", "year": "2019"}],
}

JOB = {
    "id": "job-v2-001",
    "title": "Staff Backend Engineer",
    "company": "Stripe",
    "description": (
        "We are looking for a Staff Backend Engineer with deep expertise in Python, "
        "distributed systems, REST APIs, and payment processing. "
        "Required: Kubernetes, PostgreSQL, FastAPI, CI/CD, gRPC."
    ),
}

KEYWORDS_RESPONSE = json.dumps(
    ["Python", "distributed systems", "REST APIs", "payment processing",
     "Kubernetes", "PostgreSQL", "FastAPI", "CI/CD", "gRPC", "Staff Engineer",
     "backend", "microservices", "API design", "scalability", "SLO"]
)

TAILORED_RESUME_V2 = {
    **BASE_RESUME,
    "summary": "Staff Backend Engineer with Python, Kubernetes, FastAPI expertise.",
    "experience": [
        {
            "company": "Acme Corp",
            "title": "Senior Engineer",
            "years": "2021-2024",
            "bullets": [
                "Reduced API latency by 40% for 50M+ daily requests using async batching",
                "Led Kubernetes migration cutting deployment time by 60%",
                "Designed CI/CD pipeline reducing release cycle from 2 weeks to 1 day",
            ],
        }
    ],
}

CRITIQUED_RESUME = {
    **TAILORED_RESUME_V2,
    "experience": [
        {
            "company": "Acme Corp",
            "title": "Senior Engineer",
            "years": "2021-2024",
            "bullets": [
                "Reduced API latency by 40% for 50M+ daily requests using async batching",
                "Led Kubernetes migration cutting deployment time by 60%",
                "Designed CI/CD pipeline reducing release cycle from 2 weeks to 1 day",
            ],
        }
    ],
}


# ── ATS Keyword Extraction ─────────────────────────────────────────────────────

class TestExtractAtsKeywords:
    @pytest.mark.asyncio
    async def test_returns_list_of_strings(self):
        with patch("worker.ai.keywords._call_openai", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = KEYWORDS_RESPONSE
            result = await extract_ats_keywords(JOB["description"], "sk-test")

        assert isinstance(result, list)
        assert len(result) >= 5
        assert all(isinstance(k, str) for k in result)

    @pytest.mark.asyncio
    async def test_handles_wrapped_json_object(self):
        """Some models return {"keywords": [...]} instead of a bare array."""
        wrapped = json.dumps({"keywords": ["Python", "FastAPI", "Kubernetes"]})
        with patch("worker.ai.keywords._call_openai", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = wrapped
            result = await extract_ats_keywords(JOB["description"], "sk-test")

        assert "Python" in result
        assert "FastAPI" in result

    @pytest.mark.asyncio
    async def test_strips_markdown_fences(self):
        fenced = f"```json\n{KEYWORDS_RESPONSE}\n```"
        with patch("worker.ai.keywords._call_openai", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = fenced
            result = await extract_ats_keywords(JOB["description"], "sk-test")

        assert isinstance(result, list)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_empty_description_returns_empty(self):
        result = await extract_ats_keywords("   ", "sk-test")
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_json_error(self):
        with patch("worker.ai.keywords._call_openai", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = "not json"
            result = await extract_ats_keywords(JOB["description"], "sk-test")

        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_timeout(self):
        with patch("worker.ai.keywords._call_openai", new_callable=AsyncMock) as mock_ai:
            mock_ai.side_effect = asyncio.TimeoutError()
            result = await extract_ats_keywords(JOB["description"], "sk-test")

        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_on_api_error(self):
        with patch("worker.ai.keywords._call_openai", new_callable=AsyncMock) as mock_ai:
            mock_ai.side_effect = RuntimeError("API error")
            result = await extract_ats_keywords(JOB["description"], "sk-test")

        assert result == []


# ── Self-Critique Pass ─────────────────────────────────────────────────────────

class TestCritiqueResume:
    @pytest.mark.asyncio
    async def test_rewrites_failing_bullets(self):
        with patch("worker.ai.critique._call_openai", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = json.dumps(CRITIQUED_RESUME)
            result = await critique_resume(BASE_RESUME, "sk-test")

        assert isinstance(result, dict)
        # Critiqued version should not start bullets with weak openers
        bullets = result["experience"][0]["bullets"]
        for bullet in bullets:
            assert not bullet.lower().startswith("responsible for"), \
                f"Weak bullet survived critique: {bullet}"
            assert not bullet.lower().startswith("helped"), \
                f"Weak bullet survived critique: {bullet}"

    @pytest.mark.asyncio
    async def test_preserves_schema(self):
        """Critique must return the same top-level keys as input."""
        with patch("worker.ai.critique._call_openai", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = json.dumps(CRITIQUED_RESUME)
            result = await critique_resume(BASE_RESUME, "sk-test")

        assert set(result.keys()) == set(BASE_RESUME.keys())

    @pytest.mark.asyncio
    async def test_nondestructive_on_json_error(self):
        with patch("worker.ai.critique._call_openai", new_callable=AsyncMock) as mock_ai:
            mock_ai.return_value = "not valid json {{{"
            result = await critique_resume(BASE_RESUME, "sk-test")

        assert result == BASE_RESUME  # returns original unchanged

    @pytest.mark.asyncio
    async def test_nondestructive_on_timeout(self):
        with patch("worker.ai.critique._call_openai", new_callable=AsyncMock) as mock_ai:
            mock_ai.side_effect = asyncio.TimeoutError()
            result = await critique_resume(BASE_RESUME, "sk-test")

        assert result == BASE_RESUME

    @pytest.mark.asyncio
    async def test_nondestructive_on_api_error(self):
        with patch("worker.ai.critique._call_openai", new_callable=AsyncMock) as mock_ai:
            mock_ai.side_effect = RuntimeError("API down")
            result = await critique_resume(BASE_RESUME, "sk-test")

        assert result == BASE_RESUME

    def test_critique_system_prompt_covers_five_rules(self):
        """The critique system prompt must reference all 5 STAR/CAR rubric rules A-E."""
        from worker.ai.critique import _CRITIQUE_SYSTEM
        for rule in ("A:", "B:", "C:", "D:", "E:"):
            assert rule in _CRITIQUE_SYSTEM, f"Missing rule {rule} in critique system prompt"

    def test_critique_system_forbids_weak_openers(self):
        """The system prompt must explicitly ban 'Responsible for', 'Helped', 'Assisted'."""
        from worker.ai.critique import _CRITIQUE_SYSTEM
        for weak in ("Responsible for", "Helped", "Assisted"):
            assert weak in _CRITIQUE_SYSTEM, \
                f"'{weak}' not banned in critique system prompt"

    def test_critique_system_requires_quantification(self):
        """Rule B: bullets must have quantified outcomes."""
        from worker.ai.critique import _CRITIQUE_SYSTEM
        assert "quantified" in _CRITIQUE_SYSTEM.lower() or "%" in _CRITIQUE_SYSTEM


# ── V2 tailor_resume pipeline ─────────────────────────────────────────────────

class TestTailorResumeV2:
    @pytest.mark.asyncio
    async def test_v2_pipeline_end_to_end(self):
        """With flag ON: keywords → generate → critique → return."""
        with patch("worker.ai.tailor.settings") as mock_settings, \
             patch("worker.ai.tailor.extract_ats_keywords", new_callable=AsyncMock) as mock_kw, \
             patch("worker.ai.tailor._call_openai", new_callable=AsyncMock) as mock_ai, \
             patch("worker.ai.tailor.critique_resume", new_callable=AsyncMock) as mock_crit:

            mock_settings.resume_quality_v2 = True
            mock_settings.openai_api_key = "sk-test"
            mock_kw.return_value = ["Python", "Kubernetes", "FastAPI", "CI/CD", "gRPC"]
            mock_ai.return_value = json.dumps(TAILORED_RESUME_V2)
            mock_crit.return_value = CRITIQUED_RESUME

            result, tokens, model = await tailor_resume(
                BASE_RESUME, JOB, "sk-test", "job-v2-e2e"
            )

        assert isinstance(result, dict)
        assert model == TAILOR_MODEL
        assert tokens > 0
        mock_kw.assert_called_once()
        mock_crit.assert_called_once()

    @pytest.mark.asyncio
    async def test_v2_flag_off_uses_v1(self):
        """With flag OFF: keywords and critique must NOT be called."""
        with patch("worker.ai.tailor.settings") as mock_settings, \
             patch("worker.ai.tailor.extract_ats_keywords", new_callable=AsyncMock) as mock_kw, \
             patch("worker.ai.tailor._call_openai", new_callable=AsyncMock) as mock_ai, \
             patch("worker.ai.tailor.critique_resume", new_callable=AsyncMock) as mock_crit:

            mock_settings.resume_quality_v2 = False
            mock_settings.openai_api_key = "sk-test"
            mock_ai.return_value = json.dumps(TAILORED_RESUME_V2)

            result, tokens, model = await tailor_resume(
                BASE_RESUME, JOB, "sk-test", "job-v1-only"
            )

        mock_kw.assert_not_called()
        mock_crit.assert_not_called()
        assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_v2_keyword_retry_triggered(self):
        """If >50% keywords missing from output, a second _call_openai call is made."""
        # Resume that deliberately omits all 5 test keywords
        sparse_resume = {
            "summary": "Experienced engineer.",
            "experience": [{"company": "Corp", "title": "Dev", "years": "2020-2024",
                             "bullets": ["Shipped features on time"]}],
            "skills": ["Java", "MySQL"],
            "education": [],
        }
        sparse_json = json.dumps(sparse_resume)

        enriched_resume = {
            **sparse_resume,
            "summary": "Python Kubernetes FastAPI CI/CD gRPC expert.",
        }
        enriched_json = json.dumps(enriched_resume)

        with patch("worker.ai.tailor.settings") as mock_settings, \
             patch("worker.ai.tailor.extract_ats_keywords", new_callable=AsyncMock) as mock_kw, \
             patch("worker.ai.tailor._call_openai", new_callable=AsyncMock) as mock_ai, \
             patch("worker.ai.tailor.critique_resume", new_callable=AsyncMock) as mock_crit:

            mock_settings.resume_quality_v2 = True
            mock_settings.openai_api_key = "sk-test"
            mock_kw.return_value = ["Python", "Kubernetes", "FastAPI", "CI/CD", "gRPC"]
            # First call returns sparse output; second call returns enriched
            mock_ai.side_effect = [sparse_json, enriched_json]
            mock_crit.return_value = enriched_resume

            result, _, _ = await tailor_resume(
                BASE_RESUME, JOB, "sk-test", "job-v2-retry"
            )

        # Two _call_openai calls: initial + retry
        assert mock_ai.call_count == 2

    @pytest.mark.asyncio
    async def test_v2_no_retry_when_keywords_present(self):
        """If all keywords present in output, no retry call is made."""
        # Build a resume that contains all 5 keywords
        rich_resume = {
            **TAILORED_RESUME_V2,
            "summary": "Python Kubernetes FastAPI CI/CD gRPC all present.",
        }
        rich_json = json.dumps(rich_resume)

        with patch("worker.ai.tailor.settings") as mock_settings, \
             patch("worker.ai.tailor.extract_ats_keywords", new_callable=AsyncMock) as mock_kw, \
             patch("worker.ai.tailor._call_openai", new_callable=AsyncMock) as mock_ai, \
             patch("worker.ai.tailor.critique_resume", new_callable=AsyncMock) as mock_crit:

            mock_settings.resume_quality_v2 = True
            mock_settings.openai_api_key = "sk-test"
            mock_kw.return_value = ["Python", "Kubernetes", "FastAPI", "CI/CD", "gRPC"]
            mock_ai.return_value = rich_json
            mock_crit.return_value = rich_resume

            await tailor_resume(BASE_RESUME, JOB, "sk-test", "job-v2-no-retry")

        assert mock_ai.call_count == 1

    @pytest.mark.asyncio
    async def test_v2_output_schema_stability(self):
        """V2 output must preserve the same top-level keys as the input resume."""
        with patch("worker.ai.tailor.settings") as mock_settings, \
             patch("worker.ai.tailor.extract_ats_keywords", new_callable=AsyncMock) as mock_kw, \
             patch("worker.ai.tailor._call_openai", new_callable=AsyncMock) as mock_ai, \
             patch("worker.ai.tailor.critique_resume", new_callable=AsyncMock) as mock_crit:

            mock_settings.resume_quality_v2 = True
            mock_settings.openai_api_key = "sk-test"
            mock_kw.return_value = ["Python", "Kubernetes"]
            mock_ai.return_value = json.dumps(CRITIQUED_RESUME)
            mock_crit.return_value = CRITIQUED_RESUME

            result, _, _ = await tailor_resume(
                BASE_RESUME, JOB, "sk-test", "job-v2-schema"
            )

        assert set(result.keys()) >= {"summary", "experience", "skills", "education"}

    @pytest.mark.asyncio
    async def test_v2_nondestructive_fallback_on_json_error(self):
        with patch("worker.ai.tailor.settings") as mock_settings, \
             patch("worker.ai.tailor.extract_ats_keywords", new_callable=AsyncMock) as mock_kw, \
             patch("worker.ai.tailor._call_openai", new_callable=AsyncMock) as mock_ai, \
             patch("worker.ai.tailor.critique_resume", new_callable=AsyncMock) as mock_crit:

            mock_settings.resume_quality_v2 = True
            mock_settings.openai_api_key = "sk-test"
            mock_kw.return_value = ["Python"]
            mock_ai.return_value = "INVALID JSON {{{"
            mock_crit.return_value = BASE_RESUME  # won't be reached

            result, tokens, _ = await tailor_resume(
                BASE_RESUME, JOB, "sk-test", "job-v2-fallback"
            )

        # Should fall back to original base resume (non-destructive)
        assert result == BASE_RESUME
        assert tokens == 0

    @pytest.mark.asyncio
    async def test_v2_separate_cache_key_from_v1(self):
        """V2 must use a different cache key so V1 and V2 results don't collide."""
        with patch("worker.ai.tailor.settings") as mock_settings, \
             patch("worker.ai.tailor.extract_ats_keywords", new_callable=AsyncMock) as mock_kw, \
             patch("worker.ai.tailor._call_openai", new_callable=AsyncMock) as mock_ai, \
             patch("worker.ai.tailor.critique_resume", new_callable=AsyncMock) as mock_crit:

            mock_settings.resume_quality_v2 = True
            mock_settings.openai_api_key = "sk-test"
            mock_kw.return_value = ["Python"]
            mock_ai.return_value = json.dumps(TAILORED_RESUME_V2)
            mock_crit.return_value = TAILORED_RESUME_V2

            # First call — populates V2 cache
            await tailor_resume(BASE_RESUME, JOB, "sk-test", "job-cachekey")
            v2_calls = mock_ai.call_count

            # Switch to V1 — must not hit the V2 cache
            mock_settings.resume_quality_v2 = False
            mock_ai.return_value = json.dumps({**BASE_RESUME, "summary": "V1 result"})
            r, _, _ = await tailor_resume(BASE_RESUME, JOB, "sk-test", "job-cachekey")

        # V1 path must have made a new call (not served V2 cache)
        assert mock_ai.call_count > v2_calls
        assert r["summary"] == "V1 result"


# ── V2 tailor_cover_letter pipeline ───────────────────────────────────────────

class TestTailorCoverLetterV2:
    @pytest.mark.asyncio
    async def test_v2_cover_letter_end_to_end(self):
        letter = "Dear Stripe, I am a Python expert with Kubernetes and FastAPI skills. [200 words]"
        with patch("worker.ai.tailor.settings") as mock_settings, \
             patch("worker.ai.tailor.extract_ats_keywords", new_callable=AsyncMock) as mock_kw, \
             patch("worker.ai.tailor._call_openai", new_callable=AsyncMock) as mock_ai:

            mock_settings.resume_quality_v2 = True
            mock_settings.openai_api_key = "sk-test"
            mock_kw.return_value = ["Python", "Kubernetes", "FastAPI"]
            mock_ai.return_value = letter

            text, tokens, model = await tailor_cover_letter(
                BASE_RESUME, JOB, "sk-test", "job-cl-v2"
            )

        assert isinstance(text, str)
        assert len(text) > 0
        assert model == TAILOR_MODEL
        assert tokens > 0
        mock_kw.assert_called_once()

    @pytest.mark.asyncio
    async def test_v2_cover_flag_off_uses_v1(self):
        with patch("worker.ai.tailor.settings") as mock_settings, \
             patch("worker.ai.tailor.extract_ats_keywords", new_callable=AsyncMock) as mock_kw, \
             patch("worker.ai.tailor._call_openai", new_callable=AsyncMock) as mock_ai:

            mock_settings.resume_quality_v2 = False
            mock_settings.openai_api_key = "sk-test"
            mock_ai.return_value = "V1 cover letter text."

            text, _, _ = await tailor_cover_letter(
                BASE_RESUME, JOB, "sk-test", "job-cl-v1"
            )

        mock_kw.assert_not_called()
        assert "V1 cover letter text." in text

    @pytest.mark.asyncio
    async def test_v2_cover_nondestructive_on_error(self):
        with patch("worker.ai.tailor.settings") as mock_settings, \
             patch("worker.ai.tailor.extract_ats_keywords", new_callable=AsyncMock) as mock_kw, \
             patch("worker.ai.tailor._call_openai", new_callable=AsyncMock) as mock_ai:

            mock_settings.resume_quality_v2 = True
            mock_settings.openai_api_key = "sk-test"
            mock_kw.return_value = ["Python"]
            mock_ai.side_effect = RuntimeError("API error")

            text, tokens, _ = await tailor_cover_letter(
                BASE_RESUME, JOB, "sk-test", "job-cl-v2-err"
            )

        assert text == ""
        assert tokens == 0
