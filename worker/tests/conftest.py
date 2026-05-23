"""
conftest.py — Worker test fixtures.

Sets stub environment variables so worker.config.Settings can be
instantiated during test collection without a real .env file.

Also pre-injects a mock `weasyprint` module so unit tests can run without
the system libraries (libpango, libcairo, etc.) that WeasyPrint requires.
`patch("weasyprint.HTML")` then works by replacing the attribute on the stub.
"""
import sys
import os
from unittest.mock import MagicMock

# Inject required settings before any worker module is imported.
# These are test-only stubs — never real credentials.
os.environ.setdefault("WORKER_SECRET", "test-worker-secret-stub")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("OPENAI_API_KEY", "sk-test-stub")

# Pre-stub weasyprint so it can be imported (and patched) without system libs.
# Real WeasyPrint (if installed) takes precedence; stub only inserted when missing.
try:
    import weasyprint as _wp  # noqa: F401 — just checking importability
except (ImportError, OSError):
    _mock_wp = MagicMock()
    sys.modules.setdefault("weasyprint", _mock_wp)
