"""
recruitee.py — Recruitee public offers scraper (no auth).

EU-SMB heavy. Each company exposes its open roles at
``https://{company}.recruitee.com/api/offers/``. The offer's careers_apply_url
is a recruitee.com page that the CareerOps GENERIC handler fills (Recruitee has
no dedicated handler — generic is tried first per the Phase 2 spec).

    → { "offers": [ { id, title, location, city, country_code,
                      careers_url, careers_apply_url, published_at } ] }
"""
import asyncio
import random
import re

import httpx
import structlog

logger = structlog.get_logger(__name__)

_HEADERS = {"User-Agent": "ResumeAI-Worker/1.0 (support@example.com)", "Accept": "application/json"}

# Curated Recruitee company slugs (EU SMB). Unknown/empty slugs are skipped.
_COMPANIES: list[str] = [
    "personio", "recruitee", "leapsome", "sumup", "tide", "contentful",
    "wefox", "raisin", "blinkist", "tier", "getyourguide", "mollie",
]


def _matches(title: str, query: str) -> bool:
    if not query:
        return True
    words = [w for w in re.split(r"[\s,/\-]+", query.lower()) if w]
    t = title.lower()
    return any(w in t for w in words)


async def _fetch_company(client: httpx.AsyncClient, company: str) -> list[dict]:
    try:
        r = await client.get(f"https://{company}.recruitee.com/api/offers/")
        if r.status_code != 200:
            return []
        offers = r.json().get("offers", []) or []
        out = []
        for o in offers:
            url = o.get("careers_apply_url") or o.get("careers_url") or ""
            loc = o.get("location") or ", ".join(filter(None, [o.get("city"), o.get("country_code")]))
            out.append({
                "id": f"recruitee_{company}_{o.get('id','')}",
                "title": o.get("title", ""),
                "company": company.replace("-", " ").title(),
                "location": loc or "Remote",
                "salary": "",
                "url": url,
                "apply_url": url,
                "description": re.sub(r"<[^>]+>", " ", o.get("description") or "")[:2000],
                "source": "recruitee",
                "apply_email": None,
                "tags": [o.get("department", "")] if o.get("department") else [],
                "posted_at": o.get("published_at") or "",
                "remote": "remote" in (loc or "").lower() or bool(o.get("remote")),
            })
        return out
    except Exception as exc:
        logger.warning("recruitee.fetch_failed", company=company, error=str(exc))
        return []


async def search(query: str = "", location: str = "", limit: int = 100) -> list[dict]:
    """Search curated Recruitee company boards in parallel, filtered by title."""
    companies = list(_COMPANIES)
    random.shuffle(companies)
    async with httpx.AsyncClient(timeout=10, headers=_HEADERS) as client:
        batches = await asyncio.gather(*[_fetch_company(client, c) for c in companies])

    out, seen = [], set()
    for batch in batches:
        for job in batch:
            if job["id"] in seen:
                continue
            seen.add(job["id"])
            if _matches(job["title"], query):
                out.append(job)
    logger.info("recruitee.search_complete", query=query, returned=min(len(out), limit))
    return out[:limit]
