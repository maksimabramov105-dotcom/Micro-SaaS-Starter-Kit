"""
ashby.py — Ashby public job-board scraper (no auth).

Fast-growing startups, often remote/international, with very responsive
recruiters. Each job's applyUrl is a jobs.ashbyhq.com URL the CareerOps Ashby
handler fills, and the feed exposes isRemote directly — great for eligibility.

    https://api.ashbyhq.com/posting-api/job-board/{org}
    → { "jobs": [ { id, title, location, isRemote, workplaceType,
                    publishedAt (ISO), jobUrl, applyUrl } ] }
"""
import asyncio
import random
import re

import httpx
import structlog

logger = structlog.get_logger(__name__)

_HEADERS = {"User-Agent": "ResumeAI-Worker/1.0 (support@example.com)", "Accept": "application/json"}

# Curated companies verified to expose an Ashby public job board.
_COMPANIES: list[str] = [
    "ramp", "linear", "vercel", "replit", "runway", "hex", "posthog",
    "browserbase", "clerk", "supabase", "render", "deno", "mux", "modal",
]


def _matches(title: str, query: str) -> bool:
    if not query:
        return True
    words = [w for w in re.split(r"[\s,/\-]+", query.lower()) if w]
    t = title.lower()
    return all(w in t for w in words)  # AND: all query words must match the title


async def _fetch_org(client: httpx.AsyncClient, org: str) -> list[dict]:
    try:
        r = await client.get(f"https://api.ashbyhq.com/posting-api/job-board/{org}")
        if r.status_code != 200:
            return []
        jobs = r.json().get("jobs", []) or []
        out = []
        for j in jobs:
            if j.get("isListed") is False:
                continue
            url = j.get("applyUrl") or j.get("jobUrl") or ""
            loc = j.get("location") or ""
            out.append({
                "id": f"ashby_{org}_{j.get('id','')}",
                "title": j.get("title", ""),
                "company": org.replace("-", " ").title(),
                "location": loc or "Remote",
                "salary": "",
                "url": url,
                "apply_url": url,
                "description": re.sub(r"<[^>]+>", " ", j.get("descriptionPlain") or "")[:2000],
                "source": "ashby",
                "apply_email": None,
                "tags": [j.get("department", "")] if j.get("department") else [],
                "posted_at": j.get("publishedAt") or "",
                "remote": bool(j.get("isRemote")) or (j.get("workplaceType") == "Remote") or "remote" in loc.lower(),
            })
        return out
    except Exception as exc:
        logger.warning("ashby.fetch_failed", org=org, error=str(exc))
        return []


async def search(query: str = "", location: str = "", limit: int = 100) -> list[dict]:
    """Search curated Ashby boards in parallel, filtered by title."""
    orgs = list(_COMPANIES)
    random.shuffle(orgs)
    async with httpx.AsyncClient(timeout=10, headers=_HEADERS) as client:
        batches = await asyncio.gather(*[_fetch_org(client, o) for o in orgs])

    out, seen = [], set()
    for batch in batches:
        for job in batch:
            if job["id"] in seen:
                continue
            seen.add(job["id"])
            if _matches(job["title"], query):
                out.append(job)
    logger.info("ashby.search_complete", query=query, returned=min(len(out), limit))
    return out[:limit]
