"""
personio.py — Personio public XML scraper (no auth).

DACH/EU SMB; great for EU relocation/remote. Each company exposes open roles at
``https://{company}.jobs.personio.de/xml?language=en``. The job page is filled
by the CareerOps GENERIC handler (no dedicated handler — generic is tried first).

    <position><id/><office/><department/><name/>…</position>

NOTE: many Personio boards sit behind bot protection that returns an HTML
challenge instead of XML; those companies are skipped gracefully (the adapter
only parses real ``text/xml`` responses).
"""
import asyncio
import random
import re

import httpx
import structlog

logger = structlog.get_logger(__name__)

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ResumeAI-Worker/1.0)", "Accept": "application/xml,text/xml"}

# Curated Personio company slugs (DACH/EU). Bot-protected boards are skipped.
_COMPANIES: list[str] = [
    "personio", "sennder", "mambu", "scalable", "gympass", "forto", "wefox",
]


def _tag(block: str, name: str) -> str:
    m = re.search(rf"<{name}>(.*?)</{name}>", block, re.S)
    return re.sub(r"<[^>]+>", " ", m.group(1)).strip() if m else ""


def _matches(title: str, query: str) -> bool:
    if not query:
        return True
    words = [w for w in re.split(r"[\s,/\-]+", query.lower()) if w]
    t = title.lower()
    return any(w in t for w in words)


async def _fetch_company(client: httpx.AsyncClient, company: str) -> list[dict]:
    try:
        r = await client.get(f"https://{company}.jobs.personio.de/xml", params={"language": "en"})
        ctype = r.headers.get("content-type", "")
        if r.status_code != 200 or "xml" not in ctype:
            return []  # HTML challenge / bot protection → skip
        out = []
        for block in re.findall(r"<position>(.*?)</position>", r.text, re.S):
            jid = _tag(block, "id")
            office = _tag(block, "office")
            url = f"https://{company}.jobs.personio.de/job/{jid}?language=en"
            out.append({
                "id": f"personio_{company}_{jid}",
                "title": _tag(block, "name"),
                "company": company.replace("-", " ").title(),
                "location": office or "Remote",
                "salary": "",
                "url": url,
                "apply_url": url,
                "description": _tag(block, "jobDescriptions")[:2000],
                "source": "personio",
                "apply_email": None,
                "tags": [_tag(block, "department")] if _tag(block, "department") else [],
                "posted_at": "",
                "remote": "remote" in office.lower(),
            })
        return out
    except Exception as exc:
        logger.warning("personio.fetch_failed", company=company, error=str(exc))
        return []


async def search(query: str = "", location: str = "", limit: int = 100) -> list[dict]:
    """Search curated Personio company boards in parallel, filtered by title."""
    companies = list(_COMPANIES)
    random.shuffle(companies)
    async with httpx.AsyncClient(timeout=10, headers=_HEADERS, follow_redirects=True) as client:
        batches = await asyncio.gather(*[_fetch_company(client, c) for c in companies])

    out, seen = [], set()
    for batch in batches:
        for job in batch:
            if job["id"] in seen:
                continue
            seen.add(job["id"])
            if _matches(job["title"], query):
                out.append(job)
    logger.info("personio.search_complete", query=query, returned=min(len(out), limit))
    return out[:limit]
