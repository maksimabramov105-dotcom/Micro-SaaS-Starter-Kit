"""
jobs.py — All job-related API routes.

All endpoints require Authorization: Bearer <WORKER_SECRET>.

Job lifecycle:
  POST  /jobs/...          creates job, runs work, returns {job_id, status, result}
  GET   /jobs/{job_id}     returns stored job status + result

Job records are persisted in Redis (24 h TTL) and mirrored in a local in-process
dict for zero-latency same-process lookups.  Redis persistence survives worker
restarts; the local dict is a fast-path cache only.
"""
import uuid
from datetime import datetime, timezone
from io import BytesIO
from typing import Any
from typing import Literal

import redis.asyncio as aioredis
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response as FastAPIResponse
from pydantic import BaseModel

from worker.ai.cover_letter import generate_cover_letter
from worker.ai.resume import generate_tailored_resume
from worker.autoapply.careerops import CareerOpsApplicator
from worker.autoapply.common import prepare_application
from worker.autoapply.linkedin import LinkedInApplicator
from worker.config import settings
from worker.deps import verify_bearer
from worker.scrapers import adzuna, arbeitnow, greenhouse, remoteok, themuse

logger = structlog.get_logger(__name__)
router = APIRouter()

# ── Job store (in-process cache + Redis persistence) ─────────────────────────

JobStatusLiteral = Literal["pending", "running", "done", "error"]

_JOB_TTL = 86_400  # 24 hours


class JobRecord(BaseModel):
    job_id: str
    status: JobStatusLiteral
    result: Any = None
    error: str | None = None
    created_at: datetime
    completed_at: datetime | None = None


# Local in-process mirror — fast path for same-process GET requests
_jobs: dict[str, JobRecord] = {}


async def _redis_save(job: JobRecord) -> None:
    """Persist job record to Redis with 24 h TTL. Fails silently (non-critical)."""
    if not settings.redis_url:
        return
    try:
        async with aioredis.from_url(settings.redis_url, decode_responses=True) as r:
            await r.setex(f"job:{job.job_id}", _JOB_TTL, job.model_dump_json())
    except Exception as exc:
        logger.warning("job_store.redis_write_failed", job_id=job.job_id, error=str(exc))


async def _redis_load(job_id: str) -> "JobRecord | None":
    """Load job record from Redis. Returns None on miss or error."""
    if not settings.redis_url:
        return None
    try:
        async with aioredis.from_url(settings.redis_url, decode_responses=True) as r:
            data = await r.get(f"job:{job_id}")
        if data:
            return JobRecord.model_validate_json(data)
    except Exception as exc:
        logger.warning("job_store.redis_read_failed", job_id=job_id, error=str(exc))
    return None


async def _new_job() -> JobRecord:
    """Create a new job, register it in the local cache, and immediately persist
    to Redis so it's visible to GET /jobs/{job_id} even if the worker crashes
    before the work completes."""
    job = JobRecord(
        job_id=str(uuid.uuid4()),
        status="running",
        created_at=datetime.now(timezone.utc),
    )
    _jobs[job.job_id] = job
    await _redis_save(job)  # persist "running" state at creation
    return job


def _finish(job: JobRecord, result: Any) -> JobRecord:
    job.status = "done"
    job.result = result
    job.completed_at = datetime.now(timezone.utc)
    return job


def _fail(job: JobRecord, error: str) -> JobRecord:
    job.status = "error"
    job.error = error
    job.completed_at = datetime.now(timezone.utc)
    return job


# ── Request bodies ────────────────────────────────────────────────────────────

class ResumeGenerateRequest(BaseModel):
    user_id: str          # Prisma CUID string (not int)
    resume_input: str
    job_title: str
    company: str = ""
    job_description: str = ""


class CoverLetterRequest(BaseModel):
    user_id: str          # Prisma CUID string (not int)
    resume_text: str
    job_title: str
    company: str = ""
    job_description: str = ""


class LinkedInApplyRequest(BaseModel):
    user_id: int
    campaign_id: int
    email: str
    password_encrypted: str
    job_title: str
    location: str


class CareerOpsApplyRequest(BaseModel):
    user_id: int
    campaign_id: int
    apply_url: str
    user_data: dict


class ScrapeRequest(BaseModel):
    keywords: str
    location: str = ""
    since: str | None = None  # reserved for future filtering


class TailorRequest(BaseModel):
    """
    Request body for POST /jobs/autoapply/prepare.

    The web app calls this BEFORE submitting an application to get the
    tailored resume + cover letter. It then saves both to JobApplication
    and passes the tailored text to the ATS applicator.
    """
    base_resume: dict           # Resume.generated JSON from DB
    job: dict                   # {title, company, description, id?}
    plan_tier: str = "free"     # "free" | "trial" | "pro" | "unlimited"
    application_count: int = 0  # 0-indexed count in session (for trial gate)
    job_id: str = ""            # stable job identifier for cache key


class ResumePdfRequest(BaseModel):
    resume_text: str
    title: str = "Resume"


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/resume/generate", dependencies=[Depends(verify_bearer)])
async def resume_generate(body: ResumeGenerateRequest) -> dict:
    """Generate a tailored resume using OpenAI."""
    job = await _new_job()
    logger.info("job.resume_generate.started", job_id=job.job_id, user_id=body.user_id)
    try:
        text = await generate_tailored_resume(
            user_profile=body.resume_input,
            vacancy_description=body.job_description,
            vacancy_title=body.job_title,
            company_name=body.company,
            api_key=settings.openai_api_key,
        )
        _finish(job, {"resume_text": text})
        logger.info("job.resume_generate.done", job_id=job.job_id)
    except Exception as exc:
        _fail(job, str(exc))
        logger.error("job.resume_generate.error", job_id=job.job_id, error=str(exc))

    await _redis_save(job)
    return job.model_dump()


@router.post("/resume/pdf", dependencies=[Depends(verify_bearer)])
async def resume_pdf(body: ResumePdfRequest) -> FastAPIResponse:
    """Generate a downloadable PDF from resume plain text using reportlab."""
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    logger.info("job.resume_pdf.started", title=body.title)
    try:
        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            rightMargin=inch,
            leftMargin=inch,
            topMargin=inch,
            bottomMargin=inch,
        )

        styles = getSampleStyleSheet()
        body_style = ParagraphStyle(
            "ResumeBody",
            parent=styles["Normal"],
            fontSize=10,
            leading=14,
            alignment=TA_LEFT,
        )
        heading_style = ParagraphStyle(
            "ResumeHeading",
            parent=styles["Normal"],
            fontSize=12,
            leading=16,
            spaceBefore=8,
            spaceAfter=2,
            fontName="Helvetica-Bold",
            alignment=TA_LEFT,
        )

        elements = []
        for line in body.resume_text.split("\n"):
            stripped = line.strip()
            if not stripped:
                elements.append(Spacer(1, 4))
                continue
            # Escape XML special chars for reportlab's Paragraph
            safe = (
                stripped
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )
            # Heuristic: ALL-CAPS short lines are section headers
            if stripped.isupper() and len(stripped) < 50:
                elements.append(Paragraph(safe, heading_style))
            else:
                elements.append(Paragraph(safe, body_style))

        doc.build(elements)
        pdf_bytes = buffer.getvalue()

        # Sanitise filename
        safe_title = "".join(
            c for c in body.title if c.isalnum() or c in " _-"
        ).strip()[:60] or "resume"

        logger.info("job.resume_pdf.done", bytes=len(pdf_bytes))
        return FastAPIResponse(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_title}.pdf"'
            },
        )
    except Exception as exc:
        logger.error("job.resume_pdf.error", error=str(exc))
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {exc}")


@router.post("/cover-letter", dependencies=[Depends(verify_bearer)])
async def cover_letter(body: CoverLetterRequest) -> dict:
    """Generate a tailored cover letter using OpenAI."""
    job = await _new_job()
    logger.info("job.cover_letter.started", job_id=job.job_id, user_id=body.user_id)
    try:
        text = await generate_cover_letter(
            resume_text=body.resume_text,
            job_title=body.job_title,
            company=body.company,
            job_description=body.job_description,
            api_key=settings.openai_api_key,
        )
        _finish(job, {"cover_letter_text": text})
        logger.info("job.cover_letter.done", job_id=job.job_id)
    except Exception as exc:
        _fail(job, str(exc))
        logger.error("job.cover_letter.error", job_id=job.job_id, error=str(exc))

    await _redis_save(job)
    return job.model_dump()


@router.post("/autoapply/prepare", dependencies=[Depends(verify_bearer)])
async def autoapply_prepare(body: TailorRequest) -> dict:
    """
    Tailor a resume + generate a cover letter for a specific job.

    Called by the web app before each autoapply submission.  Returns:
      tailored_resume (dict), tailored_cover_letter (str),
      tokens_used (int), model_used (str), tailoring_skipped (bool).

    Cost guardrail: gpt-4o-mini only; plan_tier gates Free/Trial users.
    """
    job = await _new_job()
    logger.info(
        "job.autoapply_prepare.started",
        job_id=job.job_id,
        plan_tier=body.plan_tier,
        company=body.job.get("company"),
    )
    try:
        result = await prepare_application(
            base_resume=body.base_resume,
            job=body.job,
            plan_tier=body.plan_tier,
            application_count=body.application_count,
            job_id=body.job_id,
        )
        _finish(job, result)
        logger.info(
            "job.autoapply_prepare.done",
            job_id=job.job_id,
            tokens=result.get("tokens_used", 0),
            skipped=result.get("tailoring_skipped", False),
        )
    except Exception as exc:
        _fail(job, str(exc))
        logger.error("job.autoapply_prepare.error", job_id=job.job_id, error=str(exc))

    await _redis_save(job)
    return job.model_dump()


@router.post("/autoapply/linkedin", dependencies=[Depends(verify_bearer)])
async def autoapply_linkedin(body: LinkedInApplyRequest) -> dict:
    """Run a LinkedIn Easy Apply campaign session."""
    from worker.crypto import decrypt

    job = await _new_job()
    logger.info(
        "job.linkedin.started",
        job_id=job.job_id,
        user_id=body.user_id,
        campaign_id=body.campaign_id,
    )
    try:
        password = decrypt(body.password_encrypted)
        applicator = LinkedInApplicator()
        result = await applicator.apply(
            email=body.email,
            password=password,
            job_title=body.job_title,
            location=body.location,
        )
        _finish(job, result)
        logger.info("job.linkedin.done", job_id=job.job_id)
    except Exception as exc:
        _fail(job, str(exc))
        logger.error("job.linkedin.error", job_id=job.job_id, error=str(exc))

    await _redis_save(job)
    return job.model_dump()


@router.post("/autoapply/careerops", dependencies=[Depends(verify_bearer)])
async def autoapply_careerops(body: CareerOpsApplyRequest) -> dict:
    """Submit a job application via the CareerOps ATS filler."""
    job = await _new_job()
    logger.info(
        "job.careerops.started",
        job_id=job.job_id,
        user_id=body.user_id,
        campaign_id=body.campaign_id,
    )
    try:
        applicator = CareerOpsApplicator()
        await applicator.start()
        try:
            result = await applicator.apply(body.apply_url, body.user_data)
        finally:
            await applicator.close()
        _finish(job, result)
        logger.info("job.careerops.done", job_id=job.job_id)
    except Exception as exc:
        _fail(job, str(exc))
        logger.error("job.careerops.error", job_id=job.job_id, error=str(exc))

    await _redis_save(job)
    return job.model_dump()


_SCRAPER_MAP = {
    "adzuna": adzuna.search,
    "arbeitnow": arbeitnow.search,
    "greenhouse": greenhouse.search,
    "remoteok": remoteok.search,
    "themuse": themuse.search,
}


@router.post("/scrape/{board}", dependencies=[Depends(verify_bearer)])
async def scrape_board(board: str, body: ScrapeRequest) -> dict:
    """Scrape a specific job board and return normalized job listings."""
    if board not in _SCRAPER_MAP:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown board '{board}'. Valid: {list(_SCRAPER_MAP)}",
        )
    job = await _new_job()
    logger.info("job.scrape.started", job_id=job.job_id, board=board, keywords=body.keywords)
    try:
        results = await _SCRAPER_MAP[board](
            query=body.keywords,
            location=body.location,
        )
        _finish(job, {"jobs": results, "count": len(results)})
        logger.info("job.scrape.done", job_id=job.job_id, count=len(results))
    except Exception as exc:
        _fail(job, str(exc))
        logger.error("job.scrape.error", job_id=job.job_id, error=str(exc))

    await _redis_save(job)
    return job.model_dump()


# ── WeasyPrint template renderer ─────────────────────────────────────────────

_TEMPLATES_DIR = __import__("pathlib").Path(__file__).parent.parent / "templates" / "resumes"

ALLOWED_TEMPLATES: set[str] = {
    "modern_minimalist",
    "classic_executive",
    "tech_compact",
    "creative_accent",
    "new_grad",
}


class RenderRequest(BaseModel):
    template_id: str
    resume_data: dict


@router.post("/resumes/{resume_id}/render", dependencies=[Depends(verify_bearer)])
async def render_resume(resume_id: str, body: RenderRequest) -> FastAPIResponse:
    """
    Render a resume using a WeasyPrint/Jinja2 template.

    Returns application/pdf.  The existing /resume/pdf (reportlab) route is
    kept untouched as a fallback when PDF_TEMPLATES_V1 flag is OFF.
    """
    if body.template_id not in ALLOWED_TEMPLATES:
        raise HTTPException(status_code=400, detail=f"Unknown template_id: {body.template_id!r}")

    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
        from weasyprint import HTML

        env = Environment(
            loader=FileSystemLoader(str(_TEMPLATES_DIR)),
            autoescape=select_autoescape(["html"]),
        )
        template = env.get_template(f"{body.template_id}.html")
        html_str = template.render(resume=body.resume_data)

        pdf_bytes = HTML(
            string=html_str,
            base_url=str(_TEMPLATES_DIR),
        ).write_pdf()

        safe_title = (
            "".join(
                c for c in body.resume_data.get("name", resume_id)
                if c.isalnum() or c in " _-"
            ).strip()[:60] or "resume"
        )
        logger.info(
            "resume.render.done",
            resume_id=resume_id,
            template=body.template_id,
            bytes=len(pdf_bytes),
        )
        return FastAPIResponse(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_title}.pdf"'
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("resume.render.error", resume_id=resume_id, error=str(exc))
        raise HTTPException(status_code=500, detail=f"Render failed: {exc}")


@router.get("/{job_id}", dependencies=[Depends(verify_bearer)])
async def get_job(job_id: str) -> dict:
    """Return the current status and result of a previously submitted job."""
    # Check in-process cache first (same-process fast path)
    record = _jobs.get(job_id)
    if record is None:
        # Fall back to Redis — handles cross-restart lookups
        record = await _redis_load(job_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id!r} not found",
        )
    return record.model_dump()
