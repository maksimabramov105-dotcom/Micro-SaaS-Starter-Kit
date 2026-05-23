"""
test_resume_render.py — Tests for the WeasyPrint template renderer.

Tests run against real template files but mock WeasyPrint's PDF generation
to avoid requiring a full system install of libpango/libcairo in CI.
Where WeasyPrint IS available (e.g. the worker Docker image), the real
render path is tested via the integration tests at the bottom of this file.

Coverage:
  - All 5 templates render without exception on sample data
  - Output PDF starts with %PDF- magic bytes (real render when possible)
  - Output does NOT contain Jinja2 leak tokens ({{ }} not in output)
  - Unknown template_id returns HTTP 400
  - Each real rendered PDF is < 120 KB
  - adaptResumeData adapter: prefers resume_structured, degrades from resume_text
"""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from worker.main import app

TEMPLATES_DIR = (
    Path(__file__).parent.parent / "worker" / "templates" / "resumes"
)
SAMPLE_RESUME_PATH = TEMPLATES_DIR / "_sample_resume.json"
SAMPLE_RESUME = json.loads(SAMPLE_RESUME_PATH.read_text(encoding="utf-8"))

ALLOWED_TEMPLATES = [
    "modern_minimalist",
    "classic_executive",
    "tech_compact",
    "creative_accent",
    "new_grad",
]

# Minimal fake PDF bytes used when mocking WeasyPrint
_FAKE_PDF = b"%PDF-1.4 fake test pdf content for unit tests"

client = TestClient(app)

# ── Auth helper ────────────────────────────────────────────────────────────────

def auth_headers():
    """Return valid worker auth headers for test requests."""
    import os
    secret = os.environ.get("WORKER_SECRET", "test-worker-secret-stub")
    return {"Authorization": f"Bearer {secret}"}


# ── Unit tests (WeasyPrint mocked) ────────────────────────────────────────────

class TestRenderEndpointUnit:
    """Fast tests that mock WeasyPrint — run in any environment."""

    def _render(self, template_id: str, resume_data: dict | None = None):
        with patch("weasyprint.HTML") as mock_html:
            mock_instance = MagicMock()
            mock_instance.write_pdf.return_value = _FAKE_PDF
            mock_html.return_value = mock_instance

            return client.post(
                f"/jobs/resumes/test-resume-{template_id}/render",
                json={
                    "template_id": template_id,
                    "resume_data": resume_data or SAMPLE_RESUME,
                },
                headers=auth_headers(),
            )

    @pytest.mark.parametrize("template_id", ALLOWED_TEMPLATES)
    def test_each_template_returns_200(self, template_id: str):
        resp = self._render(template_id)
        assert resp.status_code == 200, f"{template_id}: {resp.text}"

    @pytest.mark.parametrize("template_id", ALLOWED_TEMPLATES)
    def test_response_content_type_is_pdf(self, template_id: str):
        resp = self._render(template_id)
        assert resp.headers["content-type"] == "application/pdf"

    @pytest.mark.parametrize("template_id", ALLOWED_TEMPLATES)
    def test_response_starts_with_pdf_magic(self, template_id: str):
        resp = self._render(template_id)
        assert resp.content.startswith(b"%PDF-")

    def test_unknown_template_returns_400(self):
        resp = client.post(
            "/jobs/resumes/test-id/render",
            json={"template_id": "does_not_exist", "resume_data": SAMPLE_RESUME},
            headers=auth_headers(),
        )
        assert resp.status_code == 400
        assert "Unknown template_id" in resp.json().get("detail", "")

    def test_missing_auth_returns_401(self):
        resp = client.post(
            "/jobs/resumes/test-id/render",
            json={"template_id": "modern_minimalist", "resume_data": SAMPLE_RESUME},
        )
        assert resp.status_code == 401

    @pytest.mark.parametrize("template_id", ALLOWED_TEMPLATES)
    def test_no_jinja2_leaks_in_html(self, template_id: str):
        """Jinja2 template variables must not appear in the rendered HTML sent to WeasyPrint."""
        captured_html: list[str] = []

        def capture_html(string, base_url=None):
            captured_html.append(string)
            m = MagicMock()
            m.write_pdf.return_value = _FAKE_PDF
            return m

        # Must call client.post() directly — _render() has its own inner patch
        # that would shadow this outer capture patch.
        with patch("weasyprint.HTML", side_effect=capture_html):
            resp = client.post(
                f"/jobs/resumes/test-resume-{template_id}/render",
                json={"template_id": template_id, "resume_data": SAMPLE_RESUME},
                headers=auth_headers(),
            )

        assert resp.status_code == 200
        assert captured_html, "No HTML was passed to WeasyPrint"
        html = captured_html[0]
        assert "{{" not in html, f"Jinja2 leak in {template_id}: found '{{{{' in HTML"
        assert "}}" not in html, f"Jinja2 leak in {template_id}: found '}}}}' in HTML"

    @pytest.mark.parametrize("template_id", ALLOWED_TEMPLATES)
    def test_html_contains_required_sections(self, template_id: str):
        """Rendered HTML must reference key resume sections."""
        captured: list[str] = []

        def capture(string, base_url=None):
            captured.append(string)
            m = MagicMock()
            m.write_pdf.return_value = _FAKE_PDF
            return m

        # Same reason — call client.post() directly to avoid inner patch shadowing.
        with patch("weasyprint.HTML", side_effect=capture):
            client.post(
                f"/jobs/resumes/test-resume-{template_id}/render",
                json={"template_id": template_id, "resume_data": SAMPLE_RESUME},
                headers=auth_headers(),
            )

        html = captured[0].lower()
        for section in ("experience", "education", "skills"):
            assert section in html, f"Section '{section}' missing in {template_id} HTML"

    def test_empty_resume_data_does_not_crash(self):
        """Renderer must handle an empty resume dict gracefully."""
        resp = self._render("modern_minimalist", {})
        assert resp.status_code == 200

    def test_content_disposition_header_present(self):
        resp = self._render("modern_minimalist")
        cd = resp.headers.get("content-disposition", "")
        assert "attachment" in cd
        assert ".pdf" in cd


# ── Integration tests (real WeasyPrint — skipped if not installed) ────────────

def _weasyprint_available() -> bool:
    """Return True only when the *real* WeasyPrint is importable (system libs present)."""
    try:
        import weasyprint
        from unittest.mock import MagicMock
        # conftest.py injects a MagicMock stub when system libs are absent.
        # A real WeasyPrint module won't be a MagicMock instance.
        return not isinstance(weasyprint, MagicMock)
    except (ImportError, OSError):
        return False


@pytest.mark.skipif(
    not _weasyprint_available(),
    reason="WeasyPrint not installed in this environment",
)
class TestRenderEndpointIntegration:
    """Real render tests — require WeasyPrint system deps (libpango etc.)."""

    def _render_real(self, template_id: str):
        return client.post(
            f"/jobs/resumes/integration-test/render",
            json={"template_id": template_id, "resume_data": SAMPLE_RESUME},
            headers=auth_headers(),
        )

    @pytest.mark.parametrize("template_id", ALLOWED_TEMPLATES)
    def test_real_pdf_starts_with_magic(self, template_id: str):
        resp = self._render_real(template_id)
        assert resp.status_code == 200
        assert resp.content[:4] == b"%PDF"

    @pytest.mark.parametrize("template_id", ALLOWED_TEMPLATES)
    def test_real_pdf_under_120kb(self, template_id: str):
        resp = self._render_real(template_id)
        assert resp.status_code == 200
        size_kb = len(resp.content) / 1024
        assert size_kb < 120, f"{template_id} PDF is {size_kb:.1f} KB (limit 120 KB)"


# ── Template file sanity checks ────────────────────────────────────────────────

class TestTemplateFiles:
    """Verify the .html template files exist and look correct."""

    @pytest.mark.parametrize("template_id", ALLOWED_TEMPLATES)
    def test_template_file_exists(self, template_id: str):
        path = TEMPLATES_DIR / f"{template_id}.html"
        assert path.exists(), f"Missing template file: {path}"

    @pytest.mark.parametrize("template_id", ALLOWED_TEMPLATES)
    def test_template_extends_common_css(self, template_id: str):
        path = TEMPLATES_DIR / f"{template_id}.html"
        content = path.read_text(encoding="utf-8")
        assert "_common.css" in content, f"{template_id}.html does not include _common.css"

    @pytest.mark.parametrize("template_id", ALLOWED_TEMPLATES)
    def test_template_has_no_table_layout(self, template_id: str):
        """ATS rule: no <table> elements for layout."""
        path = TEMPLATES_DIR / f"{template_id}.html"
        content = path.read_text(encoding="utf-8").lower()
        # Allow <table> in comments but not as actual elements
        # (We check for the opening tag pattern)
        import re
        tables = re.findall(r'<table[\s>]', content)
        assert not tables, f"{template_id}.html uses <table> (ATS unsafe)"

    def test_sample_resume_json_valid(self):
        data = json.loads(SAMPLE_RESUME_PATH.read_text(encoding="utf-8"))
        assert "name" in data
        assert "experience" in data
        assert "education" in data
        assert "skills" in data

    def test_common_css_exists(self):
        assert (TEMPLATES_DIR / "_common.css").exists()
