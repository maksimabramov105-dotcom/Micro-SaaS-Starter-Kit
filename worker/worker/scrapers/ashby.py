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

# Remote-first / globally-hiring companies on Ashby, verified live and
# cross-functional (deel/oyster/andela/zapier are global all-functions employers;
# notion 147, ramp 111 carry heavy non-eng volume). Role-agnostic by design.
_COMPANIES: list[str] = [
    "deel", "andela", "oyster", "1password", "close", "zapier", "float",
    "notion", "ramp", "linear", "supabase", "posthog", "render", "modal",
    "replit", "benchling", "sentry", "mux", "helpscout", "gitbook", "buffer",
    # Phase A expansion — CX-tooling (gorgias/kustomer), fintech, health, media.
    "gorgias", "kustomer", "pinecone", "temporal", "airbyte", "wealthsimple",
    "pleo", "patreon", "substack", "quora", "maven",
    # Global-remote + ANZ/APAC (Airwallex AU, Xero/Auror NZ) — eligible pool for
    # non-US candidates; Docker/Confluent/Prefect hire globally remote.
    "airwallex", "xero", "auror", "confluent", "docker", "easygenerator", "prefect",
    # Phase C expansion (2026-06-14) — verified live on Ashby with high volume.
    "sierra", "vanta", "decagon", "cursor", "baseten", "ashby", "mercor",
    "gamma", "watershed", "mintlify", "browserbase", "runway",
    # Phase D expansion (2026-06-15) — verified live on Ashby with open roles.
    "deepgram", "persona", "warp", "granola", "resend", "julius", "greptile", "tldraw",
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
