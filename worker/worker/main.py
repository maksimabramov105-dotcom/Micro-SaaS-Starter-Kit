"""
main.py — FastAPI application entry point.

Lifespan:
  - Startup: initialise asyncpg pool, configure structlog
  - Shutdown: close pool

Run locally:
    uvicorn worker.main:app --reload --port 8000
"""
import json
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import sentry_sdk
import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from worker.config import settings
from worker.db import close_pool, init_pool
from worker.routes.health import router as health_router
from worker.routes.jobs import router as jobs_router

# ── Sentry — init before any request handling ─────────────────────────────────
# sentry_dsn is optional; empty string disables the SDK silently.
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        # 10% of transactions — free-tier friendly.
        traces_sample_rate=0.1,
        # Capture 100% of errors regardless of trace sampling.
        sample_rate=1.0,
        send_default_pii=False,
    )

# ── structlog configuration ─────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)


# ── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("worker.starting", version=settings.worker_version)
    await init_pool(app)
    logger.info("worker.ready")
    yield
    logger.info("worker.shutting_down")
    await close_pool(app)
    logger.info("worker.stopped")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Resume AI Worker",
    version=settings.worker_version,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS — restrict to internal / same-origin traffic only
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "http://127.0.0.1"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


# ── Request logging middleware ────────────────────────────────────────────────

@app.middleware("http")
async def log_requests(request: Request, call_next) -> Response:
    start = time.perf_counter()
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        method=request.method,
        path=request.url.path,
    )
    response: Response = await call_next(request)
    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    logger.info(
        "http.request",
        status=response.status_code,
        duration_ms=duration_ms,
    )
    return response


# ── Founder error alerting (P0.4) ─────────────────────────────────────────────
# Unhandled exceptions -> `admin_alert` on the notifier's Redis channel ->
# founder Telegram. Redis-deduped per exception+path per hour so a crash loop
# can't flood the chat. Fire-and-forget: alerting must never mask the 500.

async def _publish_admin_alert(text: str, dedupe_key: str) -> None:
    try:
        import redis.asyncio as aioredis  # lazy import — only if Redis configured

        redis_url = getattr(settings, "redis_url", "")
        if not redis_url:
            return
        async with aioredis.from_url(redis_url, decode_responses=True) as r:
            first = await r.set(f"alert:dedupe:{dedupe_key}", "1", ex=3600, nx=True)
            if not first:
                return
            await r.publish(
                "application_events",
                json.dumps({"type": "admin_alert", "text": text}),
            )
    except Exception as exc:
        logger.warning("admin_alert.publish_failed", error=str(exc))


@app.exception_handler(Exception)
async def unhandled_exception_alert(request: Request, exc: Exception) -> Response:
    logger.error(
        "http.unhandled_exception",
        path=request.url.path,
        error=str(exc),
        exc_info=exc,
    )
    summary = f"worker error\n{request.method} {request.url.path}\n{type(exc).__name__}: {str(exc)[:400]}"
    await _publish_admin_alert(summary, f"worker:{request.url.path}:{type(exc).__name__}")
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(health_router)
app.include_router(jobs_router, prefix="/jobs")
