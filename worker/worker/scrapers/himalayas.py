"""
himalayas.py — Himalayas remote-jobs scraper.

Free JSON API, no auth. Every listing is remote, and each carries
location/timezone restrictions — ideal for matching an internationally-located
candidate's eligibility.

    https://himalayas.app/jobs/api?limit=50&offset=0
    → { "jobs": [ { title, companyName, applicationLink, locationRestrictions,
                    timezoneRestrictions, pubDate, ... } ] }

Normalized dict keys match the other scrapers (id, title, company, location,
salary, url, apply_url, description, source, apply_email, tags) plus posted_at
(ISO 8601) for freshness ranking. apply_url is the external application link,
which CareerOps fills when it points at a known ATS (else it is redirected).
"""
import datetime
import re

import httpx
import structlog

logger = structlog.get_logger(__name__)

_HEADERS = {"User-Agent": "ResumeAI-Worker/1.0 (support@example.com)", "Accept": "application/json"}


def _clean_html(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()[:2000]


def _iso(pub) -> str:
    """Himalayas pubDate is epoch seconds (int) or an ISO string."""
    if not pub:
        return ""
    try:
        if isinstance(pub, (int, float)) or str(pub).isdigit():
            return datetime.datetime.fromtimestamp(int(pub), datetime.timezone.utc).isoformat()
        return str(pub)
    except Exception:
        return ""


def _matches(title: str, query: str) -> bool:
    if not query:
        return True
    words = [w for w in re.split(r"[\s,/\-]+", query.lower()) if w]
    t = title.lower()
    return any(w in t for w in words)


def _normalize(job: dict) -> dict:
    restrictions = job.get("locationRestrictions") or []
    if isinstance(restrictions, list):
        location = ", ".join(str(x) for x in restrictions[:3]) or "Remote"
    else:
        location = str(restrictions) or "Remote"
    link = job.get("applicationLink") or job.get("url") or ""
    slug = job.get("companySlug") or ""
    return {
        "id": f"himalayas_{slug}_{abs(hash(job.get('title','') + link)) % 10**10}",
        "title": job.get("title", ""),
        "company": job.get("companyName", ""),
        "location": f"Remote — {location}" if "remote" not in location.lower() else location,
        "salary": str(job.get("minSalary") or ""),
        "url": link,
        "apply_url": link,
        "description": _clean_html(job.get("description", "")),
        "source": "himalayas",
        "apply_email": None,
        "tags": job.get("categories") or [],
        "posted_at": _iso(job.get("pubDate")),
        "remote": True,
    }


async def search(query: str = "", location: str = "", limit: int = 50) -> list[dict]:
    """Fetch recent Himalayas remote jobs, filtered to ``query`` keywords by title."""
    try:
        async with httpx.AsyncClient(timeout=12, headers=_HEADERS) as client:
            r = await client.get("https://himalayas.app/jobs/api", params={"limit": min(limit * 2, 100), "offset": 0})
            if r.status_code != 200:
                logger.warning("himalayas.http_error", status=r.status_code)
                return []
            jobs = r.json().get("jobs", []) or []
    except Exception as exc:
        logger.warning("himalayas.fetch_failed", error=str(exc))
        return []

    out = [_normalize(j) for j in jobs]
    if query:
        out = [j for j in out if _matches(j["title"], query)]
    logger.info("himalayas.search_complete", query=query, returned=min(len(out), limit))
    return out[:limit]
