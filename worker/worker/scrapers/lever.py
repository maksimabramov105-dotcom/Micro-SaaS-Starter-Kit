"""
lever.py — Lever public postings scraper (no auth).

Direct-to-company startups/scaleups with fast reply rates. Each posting's
hostedUrl is a jobs.lever.co URL that the CareerOps Lever handler fills.

    https://api.lever.co/v0/postings/{company}?mode=json
    → [ { id, text, hostedUrl, applyUrl, categories:{location,team,commitment},
          createdAt (epoch ms), workplaceType, country } ]
"""
import asyncio
import datetime
import random
import re

import httpx
import structlog

logger = structlog.get_logger(__name__)

_HEADERS = {"User-Agent": "ResumeAI-Worker/1.0 (support@example.com)", "Accept": "application/json"}

# Companies verified live on Lever's public postings API, curated for interview
# probability (2026-06-15): remote-friendly mid-market employers with real
# support/CX/ops volume. Dropped FAANG / elite (Netflix, Spotify, Plaid,
# Palantir, Veeva) — too-high a bar for a non-elite candidate to convert.
_COMPANIES: list[str] = [
    "toptal", "whoop", "ro", "gopuff", "attentive", "kayak", "brevo",
    "nerdwallet", "leadgenius",
    # CX-tooling + fintech + HR-tech (cross-function depth).
    "pipedrive", "aircall", "outreach", "qonto", "lyrahealth", "15five",
    # ANZ/APAC employers (eligible pool for NZ/AU-resident candidates).
    "deputy", "immutable",
    # 2026-06-28 supply expansion — verified boards with AU-eligible/global-remote roles.
    "contentsquare", "ledger",
    # 2026-07-09 US-remote unlock — high-volume US board, eligible after adding US.
    "spotify",
]


def _matches(title: str, query: str) -> bool:
    if not query:
        return True
    words = [w for w in re.split(r"[\s,/\-]+", query.lower()) if w]
    t = title.lower()
    return all(w in t for w in words)  # AND: all query words must match the title


def _iso(created) -> str:
    try:
        return datetime.datetime.fromtimestamp(int(created) / 1000, datetime.timezone.utc).isoformat()
    except Exception:
        return ""


async def _fetch_company(client: httpx.AsyncClient, company: str) -> list[dict]:
    try:
        r = await client.get(f"https://api.lever.co/v0/postings/{company}", params={"mode": "json"})
        if r.status_code != 200:
            return []
        postings = r.json()
        out = []
        for p in postings if isinstance(postings, list) else []:
            cats = p.get("categories") or {}
            location = cats.get("location") or ""
            workplace = (p.get("workplaceType") or "").lower()
            url = p.get("hostedUrl") or p.get("applyUrl") or ""
            out.append({
                "id": f"lever_{company}_{p.get('id','')}",
                "title": p.get("text", ""),
                "company": company.replace("-", " ").title(),
                "location": location or "Remote",
                "salary": "",
                "url": url,
                "apply_url": url,
                "description": re.sub(r"<[^>]+>", " ", p.get("descriptionPlain") or "")[:2000],
                "source": "lever",
                "apply_email": None,
                "tags": [cats.get("team", "")] if cats.get("team") else [],
                "posted_at": _iso(p.get("createdAt")),
                "remote": workplace == "remote" or "remote" in location.lower(),
            })
        return out
    except Exception as exc:
        logger.warning("lever.fetch_failed", company=company, error=str(exc))
        return []


async def search(query: str = "", location: str = "", limit: int = 100) -> list[dict]:
    """Search curated Lever company boards in parallel, filtered by title."""
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
    logger.info("lever.search_complete", query=query, returned=min(len(out), limit))
    return out[:limit]
