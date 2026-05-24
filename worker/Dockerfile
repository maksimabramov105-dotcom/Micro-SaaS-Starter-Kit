FROM python:3.12-slim AS base

# ── Chromium system dependencies ──────────────────────────────────────────────
# Playwright needs these OS-level libraries to launch a headless browser.
# Installing here (in the base stage) means both builder and runtime have them.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
      libcairo2 libasound2 libx11-6 libx11-xcb1 libxcb1 libxext6 \
      libxss1 libxtst6 fonts-liberation ca-certificates wget \
      libpangoft2-1.0-0 libgdk-pixbuf-xlib-2.0-0 libffi-dev shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN addgroup --system worker && adduser --system --group worker

# ── Builder ────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY pyproject.toml .
RUN pip install uv && uv pip install --system \
      "fastapi>=0.115" \
      "uvicorn[standard]>=0.30" \
      "httpx>=0.27" \
      "asyncpg>=0.29" \
      "pydantic>=2.7" \
      "pydantic-settings>=2.3" \
      "structlog>=24" \
      "cryptography>=42" \
      "playwright>=1.44" \
      "openai>=1.30" \
      "reportlab>=4.2" \
      "redis[hiredis]>=5.0" \
      "weasyprint>=62.0" \
      "jinja2>=3.1.4" \
      "sentry-sdk[fastapi]>=2.0.0"

# Download Chromium browser to a fixed, world-readable path.
# PLAYWRIGHT_BROWSERS_PATH overrides the default ~/.cache/ms-playwright so the
# runtime stage can use it without running as the same user as the build.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install chromium

# ── Runtime ────────────────────────────────────────────────────────────────────
FROM base AS runtime
COPY --from=builder /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=builder /usr/local/bin /usr/local/bin
# Copy the downloaded Chromium browser into the runtime image
COPY --from=builder /ms-playwright /ms-playwright
COPY worker/ ./worker/

# Tell Playwright where to find the browser at runtime
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

USER worker
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "worker.main:app", "--host", "0.0.0.0", "--port", "8000"]
