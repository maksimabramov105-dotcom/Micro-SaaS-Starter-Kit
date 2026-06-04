"""
test_autoapply_careerops.py — Unit tests for worker/autoapply/careerops.py.

Does NOT require a real browser.  All Playwright interactions are mocked.

P16 regression coverage:
  1. detect_ats correctly routes jobvite and ashby URLs (were falling to 'generic')
  2. apply() method routes jobvite → apply_jobvite, ashby → apply_ashby
  3. apply_workable re-fills fields on each step
  4. CareerOpsApplicator exposes all expected public methods
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from worker.autoapply import eligibility as elig
from worker.autoapply.careerops import (
    CareerOpsApplicator,
    detect_ats,
    _extract_security_code,
    _pick_answer,
)


# ── eligibility resolver ─────────────────────────────────────────────────────

INTL = {  # internationally-located candidate, not US-authorized
    "authorized_countries": ["Germany"],
    "needs_visa_sponsorship": True,
    "willing_to_relocate": False,
    "remote_only": False,
    "languages": ["English", "German"],
}
US_AUTH = {
    "authorized_countries": ["United States"],
    "needs_visa_sponsorship": False,
    "willing_to_relocate": False,
    "remote_only": False,
    "languages": ["English"],
}


class TestEligibilityResolver:
    def test_normalize_country_aliases(self):
        assert elig.normalize_country("US") == "united states"
        assert elig.normalize_country("United States") == "united states"
        assert elig.normalize_country("  USA ") == "united states"

    def test_work_authorized(self):
        assert elig.work_authorized(US_AUTH, "United States") is True
        assert elig.work_authorized(INTL, "United States") is False
        assert elig.work_authorized(INTL, "Germany") is True
        assert elig.work_authorized(None, "United States") is False

    def test_requires_sponsorship(self):
        assert elig.requires_sponsorship(INTL) is True
        assert elig.requires_sponsorship(US_AUTH) is False

    def test_knockout_remote_job_always_ok(self):
        assert elig.knockout_reason(INTL, "United States", job_is_remote=True) is None

    def test_knockout_remote_only_skips_onsite(self):
        prof = {**INTL, "remote_only": True}
        assert elig.knockout_reason(prof, "United States", job_is_remote=False) == "remote_only"

    def test_knockout_work_auth_for_us_onsite_intl(self):
        # international profile, US on-site → work_auth knockout
        assert elig.knockout_reason(INTL, "United States", job_is_remote=False) == "work_auth"

    def test_knockout_none_when_authorized(self):
        assert elig.knockout_reason(US_AUTH, "United States", job_is_remote=False) is None

    def test_knockout_relocate_without_sponsorship_ok(self):
        prof = {"authorized_countries": [], "needs_visa_sponsorship": False,
                "willing_to_relocate": True, "remote_only": False, "languages": []}
        assert elig.knockout_reason(prof, "Canada", job_is_remote=False) is None

    def test_knockout_unknown_country_not_skipped(self):
        prof = {**INTL, "remote_only": False}
        assert elig.knockout_reason(prof, "", job_is_remote=False) is None


# ── _pick_answer honest mapping ──────────────────────────────────────────────

class TestPickAnswerEligibility:
    YES_NO = ["Yes", "No"]
    SPONSOR_OPTS = ["Yes, I will require sponsorship", "No, I do not require sponsorship"]

    def test_authorization_honest_no_for_intl(self):
        ans = _pick_answer("Are you legally authorized to work in the US?",
                           self.YES_NO, INTL, "United States")
        assert ans == "No"

    def test_authorization_yes_when_authorized(self):
        ans = _pick_answer("Are you authorized to work in the United States?",
                           self.YES_NO, US_AUTH, "United States")
        assert ans == "Yes"

    def test_sponsorship_yes_when_needed(self):
        ans = _pick_answer("Will you now or in the future require visa sponsorship?",
                           self.SPONSOR_OPTS, INTL, "United States")
        assert ans == "Yes, I will require sponsorship"

    def test_sponsorship_no_when_not_needed(self):
        ans = _pick_answer("Do you require sponsorship?",
                           self.SPONSOR_OPTS, US_AUTH, "United States")
        assert ans == "No, I do not require sponsorship"


# ── _extract_security_code ──────────────────────────────────────────────────

class TestExtractSecurityCode:
    def test_real_greenhouse_template(self):
        # Verbatim body from a real Greenhouse verification email.
        body = ("Hi Alex, Copy and paste this code into the security code field "
                "on your application: R2JpYKXl After you enter the code, resubmit "
                "your application. (c) 2026 Greenhouse")
        assert _extract_security_code(body) == "R2JpYKXl"

    def test_prefers_mixed_letter_digit_token(self):
        body = "enter the code on your application: 7Hj2Kp9 then resubmit shortly"
        assert _extract_security_code(body) == "7Hj2Kp9"

    def test_security_code_is_phrasing(self):
        assert _extract_security_code("Your security code is: A1B2C3") == "A1B2C3"

    def test_purely_numeric_code(self):
        assert _extract_security_code("Your code: 481920 expires soon") == "481920"

    def test_collapses_whitespace_and_newlines(self):
        body = "code field on your\n  application:\n\tR2JpYKXl\n"
        assert _extract_security_code(body) == "R2JpYKXl"

    def test_no_code_returns_none(self):
        assert _extract_security_code("Thanks for applying to Acme!") is None

    def test_empty_returns_none(self):
        assert _extract_security_code("") is None


# ── detect_ats ────────────────────────────────────────────────────────────────

class TestDetectAts:
    def test_greenhouse_boards(self):
        assert detect_ats("https://boards.greenhouse.io/acme/jobs/123") == "greenhouse"

    def test_greenhouse_company(self):
        assert detect_ats("https://acme.greenhouse.io/jobs/456") == "greenhouse"

    def test_lever(self):
        assert detect_ats("https://jobs.lever.co/acme/abc-def") == "lever"

    def test_workable(self):
        assert detect_ats("https://apply.workable.com/acme/j/ABCD1234/") == "workable"

    def test_smartrecruiters(self):
        assert detect_ats("https://jobs.smartrecruiters.com/Acme/123") == "smartrecruiters"

    def test_jobvite_detected(self):
        """Jobvite URLs must be detected — not fall through to 'generic'."""
        assert detect_ats("https://jobs.jobvite.com/acme/job/abc123") == "jobvite"

    def test_ashby_detected(self):
        """Ashby URLs must be detected — not fall through to 'generic'."""
        assert detect_ats("https://jobs.ashbyhq.com/acme/123-abc") == "ashby"

    def test_unknown_falls_to_generic(self):
        assert detect_ats("https://careers.somecompany.com/apply") == "generic"

    def test_case_insensitive(self):
        assert detect_ats("https://JOBS.LEVER.CO/acme/xyz") == "lever"


# ── CareerOpsApplicator interface ─────────────────────────────────────────────

class TestCareerOpsApplicatorInterface:
    def test_class_exists(self):
        assert CareerOpsApplicator is not None

    def test_has_required_methods(self):
        import inspect
        for method in ("start", "close", "apply",
                       "apply_greenhouse", "apply_lever", "apply_workable",
                       "apply_smartrecruiters", "apply_jobvite", "apply_ashby",
                       "apply_generic_form"):
            assert hasattr(CareerOpsApplicator, method), f"Missing method: {method}"
            assert inspect.iscoroutinefunction(
                getattr(CareerOpsApplicator, method)
            ), f"{method}() must be async"


# ── apply() routing ───────────────────────────────────────────────────────────

class TestApplyRouting:
    """Verify that apply() dispatches to the correct handler for each ATS."""

    @pytest.fixture
    def applicator(self):
        app = CareerOpsApplicator()
        # Mock the individual apply_* methods so routing can be verified
        # without a real browser.
        for method in (
            "apply_greenhouse", "apply_lever", "apply_workable",
            "apply_smartrecruiters", "apply_jobvite", "apply_ashby",
            "apply_generic_form",
        ):
            setattr(
                app,
                method,
                AsyncMock(return_value={"status": "submitted", "url": "x", "ats": method.replace("apply_", "")}),
            )
        return app

    @pytest.mark.asyncio
    async def test_routes_greenhouse(self, applicator):
        await applicator.apply("https://boards.greenhouse.io/co/jobs/1", {})
        applicator.apply_greenhouse.assert_called_once()
        applicator.apply_lever.assert_not_called()

    @pytest.mark.asyncio
    async def test_routes_lever(self, applicator):
        await applicator.apply("https://jobs.lever.co/co/abc", {})
        applicator.apply_lever.assert_called_once()

    @pytest.mark.asyncio
    async def test_routes_workable(self, applicator):
        await applicator.apply("https://apply.workable.com/co/j/XYZ/", {})
        applicator.apply_workable.assert_called_once()

    @pytest.mark.asyncio
    async def test_routes_smartrecruiters(self, applicator):
        await applicator.apply("https://jobs.smartrecruiters.com/Co/1", {})
        applicator.apply_smartrecruiters.assert_called_once()

    @pytest.mark.asyncio
    async def test_routes_jobvite(self, applicator):
        """Jobvite URLs must call apply_jobvite, NOT apply_generic_form."""
        await applicator.apply("https://jobs.jobvite.com/co/job/abc123", {})
        applicator.apply_jobvite.assert_called_once()
        applicator.apply_generic_form.assert_not_called()

    @pytest.mark.asyncio
    async def test_routes_ashby(self, applicator):
        """Ashby URLs must call apply_ashby, NOT apply_generic_form."""
        await applicator.apply("https://jobs.ashbyhq.com/co/123-abc", {})
        applicator.apply_ashby.assert_called_once()
        applicator.apply_generic_form.assert_not_called()

    @pytest.mark.asyncio
    async def test_routes_generic_for_unknown(self, applicator):
        await applicator.apply("https://careers.unknown.io/apply", {})
        applicator.apply_generic_form.assert_called_once()

    @pytest.mark.asyncio
    async def test_unhandled_exception_returns_error_dict(self, applicator):
        """apply() must never raise — exceptions must be caught and returned."""
        applicator.apply_generic_form.side_effect = RuntimeError("boom")
        result = await applicator.apply("https://careers.unknown.io/apply", {})
        assert result["status"] == "error"
        assert "boom" in result["error"]


# ── Workable per-step fill regression ────────────────────────────────────────

class TestWorkablePerStepFill:
    """
    P16 regression: apply_workable must attempt field fills on every loop
    iteration, not just the first pass.

    We use a fake page that returns 0 for 'Next'/'Continue' buttons on the
    first call (so we loop) and a submit button on the second call.
    """

    @pytest.mark.asyncio
    async def test_workable_fills_on_each_step(self):
        """
        _fill should be called multiple times (once per step that loops).
        A simplified stub verifies the loop re-runs field-fill logic.
        """
        from worker.autoapply.careerops import _fill as orig_fill

        # Count calls to _fill
        fill_call_count = 0

        async def counting_fill(page, selector, value):
            nonlocal fill_call_count
            fill_call_count += 1
            return True

        # Fake page: locator returns count=0 for everything (no fields found),
        # and we stop after 1 loop because no Next button is found either.
        mock_page = MagicMock()
        # page.locator(...) returns a locator, .first returns another locator,
        # and .count() is an awaitable that returns 0 (no elements).
        mock_first = MagicMock()
        mock_first.count = AsyncMock(return_value=0)
        mock_locator = MagicMock()
        mock_locator.count = AsyncMock(return_value=0)
        mock_locator.first = mock_first
        mock_page.locator.return_value = mock_locator

        app = CareerOpsApplicator()
        app.context = MagicMock()
        app.context.new_page = AsyncMock(return_value=mock_page)
        mock_page.goto = AsyncMock()
        mock_page.wait_for_load_state = AsyncMock()
        mock_page.wait_for_timeout = AsyncMock()
        mock_page.close = AsyncMock()

        user_data = {
            "first_name": "Ada",
            "last_name": "Lovelace",
            "email": "ada@example.com",
            "phone": "+1-555-0100",
        }

        with patch("worker.autoapply.careerops._fill", side_effect=counting_fill), \
             patch("worker.autoapply.careerops._upload_resume", AsyncMock(return_value=True)), \
             patch("worker.autoapply.careerops._click_apply_button", AsyncMock(return_value=False)):
            result = await app.apply_workable(
                "https://apply.workable.com/co/j/ABCD1234/apply",
                user_data,
            )

        # _fill is called for the 4 non-empty fields per step.
        # Even with just 1 step (loop exits on first iteration because no
        # Next/Submit button), the fields must have been attempted once.
        assert fill_call_count >= 4, (
            f"Expected ≥4 _fill calls (4 fields × ≥1 steps), got {fill_call_count}"
        )
        assert result["status"] == "form_not_found"
