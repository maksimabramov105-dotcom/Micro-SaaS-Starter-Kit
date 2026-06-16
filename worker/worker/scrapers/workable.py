"""
workable.py — Workable GLOBAL job-search scraper.

Unlike the per-company ATS scrapers (greenhouse/lever/ashby), Workable exposes a
GLOBAL search across EVERY company hosted on Workable:

    GET https://jobs.workable.com/api/v1/jobs?query={kw}&page={n}

This returns tens of thousands of jobs (e.g. ~24k for "support") with title,
location (+ countryName), workplace (remote/on_site/hybrid) and a
`jobs.workable.com/view/{id}` URL. That view page has an INLINE application form
revealed by an "Apply now" click — which CareerOps fills (see
apply_workable_view in autoapply/careerops.py). So this single source is a large,
genuinely-FILLABLE supply, not an unfillable aggregator board.

We page through results and normalize to the standard scraper job shape. The
caller's keyword/eligibility/fit gates still apply downstream.
"""
import httpx
import structlog

logger = structlog.get_logger(__name__)

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ResumeAI-Worker/1.0)"}
_API = "https://jobs.workable.com/api/v1/jobs"
_MAX_PAGES = 15  # 20 jobs/page → up to ~300 per keyword


def _normalize(job: dict) -> dict:
    loc = job.get("location") or {}
    city = loc.get("city") or ""
    country = loc.get("countryName") or ""
    location = ", ".join([p for p in (city, country) if p]) or "Remote"
    workplace = (job.get("workplace") or "").lower()
    is_remote = workplace == "remote" or "remote" in (job.get("title", "").lower())
    company = (job.get("company") or {}).get("title", "") if isinstance(job.get("company"), dict) else ""
    url = job.get("url", "")
    return {
        "id": f"workable_{job.get('id', '')}",
        "title": job.get("title", ""),
        "company": company or "Workable",
        "location": location,
        "remote": is_remote,
        "country": country,
        "salary": "",
        # The view URL IS the apply target — CareerOps clicks "Apply now" to
        # reveal the inline form (apply_workable_view). Not an unfillable board.
        "url": url,
        "apply_url": url,
        "description": (job.get("description") or "")[:1500],
        "source": "workable",
        "apply_email": None,
        "tags": [],
    }


async def search(query: str = "", location: str = "", limit: int = 200) -> list[dict]:
    """
    Search Workable's GLOBAL job index for ``query`` and return up to ``limit``
    normalized, fillable jobs. ``location`` is accepted for API compatibility but
    Workable's global search is keyword-driven; the caller's eligibility gate
    handles location/region.

    Pagination is CURSOR-based: each response carries a `nextPageToken` that the
    next request passes as `pageToken` (page/offset params are ignored by the
    API), so we page sequentially until we hit `limit` or run out of pages.
    """
    q = (query or "support").strip()
    out: list[dict] = []
    seen: set[str] = set()
    token: str | None = None
    async with httpx.AsyncClient(timeout=15, headers=_HEADERS, follow_redirects=True) as client:
        for _ in range(_MAX_PAGES):
            params = {"query": q}
            if token:
                params["pageToken"] = token
            try:
                r = await client.get(_API, params=params)
                if r.status_code != 200:
                    break
                data = r.json()
            except Exception as exc:
                logger.warning("workable.page_failed", error=str(exc))
                break
            for job in data.get("jobs", []) or []:
                if job.get("state") and job.get("state") != "published":
                    continue
                norm = _normalize(job)
                if norm["id"] in seen or not norm["url"]:
                    continue
                seen.add(norm["id"])
                out.append(norm)
            token = data.get("nextPageToken")
            if not token or len(out) >= limit:
                break
    logger.info("workable.search_complete", query=q, returned=min(len(out), limit))
    return out[:limit]
