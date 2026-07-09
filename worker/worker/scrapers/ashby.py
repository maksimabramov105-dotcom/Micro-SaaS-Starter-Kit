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

# Remote-first / globally-hiring companies on Ashby, curated for interview
# probability (2026-06-15): support-SaaS, EOR/global-talent, and devtools that
# hire support/ops — where a non-elite candidate converts. Dropped prestige
# unicorns + tiny eng-only AI labs (Notion, Linear, Ramp, Cursor, Sierra, Vanta,
# Decagon, Baseten, Deepgram, Mercor, Runway, Confluent, Replit, Modal, Pinecone,
# Docker, Quora, Watershed, Gamma, Warp/Granola/Greptile/Julius/Mintlify/
# Browserbase/tldraw) — too-high a bar / too eng-only to land an interview.
_COMPANIES: list[str] = [
    # EOR / global-talent (best eligibility + heavy support/ops volume)
    "deel", "andela", "oyster",
    # Support-SaaS + remote-first with real CX/ops hiring
    "1password", "close", "zapier", "float", "helpscout", "gorgias", "kustomer",
    "buffer", "gitbook", "supabase", "posthog", "render", "sentry", "mux",
    "temporal", "airbyte", "easygenerator", "prefect", "persona", "resend",
    # Fintech / media / edtech mid-market
    "wealthsimple", "pleo", "patreon", "substack", "maven",
    # ANZ/APAC (eligible pool for NZ/AU-resident candidates)
    "airwallex", "xero", "auror",
    # More mid-market support/ops/fintech (non-elite), verified live.
    "newfront", "method", "found", "keep",
    # 2026-06-28 supply expansion — verified dev-tool/remote boards w/ AU-eligible roles.
    "railway", "workos", "baseten", "neon", "inngest", "watershed", "dovetail",
    "vanta", "replit",
    # 2026-07-09 US-remote unlock — high-volume US boards, eligible after adding US.
    "notion", "ramp", "cursor", "mercor", "sardine",
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
