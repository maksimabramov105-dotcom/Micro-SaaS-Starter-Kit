"""
wwr.py — We Work Remotely scraper (public RSS feeds, no auth).

Premium global remote listings. The RSS item carries the company in the title
("Company: Role"), a region, and a pubDate. The link is the WWR listing page;
CareerOps cannot fill that directly, so WWR contributes sourcing/funnel volume
and applies via redirect when the listing links to a known ATS.

    https://weworkremotely.com/categories/remote-programming-jobs.rss
    <item><title>Acme: Senior Engineer</title><region>Anywhere in the World</region>
          <pubDate>…</pubDate><link>…</link></item>
"""
import re

import httpx
import structlog

logger = structlog.get_logger(__name__)

_HEADERS = {"User-Agent": "ResumeAI-Worker/1.0 (support@example.com)"}

# A few high-volume category feeds; combined and de-duped per call.
_FEEDS = [
    "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
    "https://weworkremotely.com/categories/remote-customer-support-jobs.rss",
    "https://weworkremotely.com/remote-jobs.rss",
]


def _tag(block: str, name: str) -> str:
    m = re.search(rf"<{name}>(.*?)</{name}>", block, re.S)
    if not m:
        return ""
    val = m.group(1)
    cdata = re.search(r"<!\[CDATA\[(.*?)\]\]>", val, re.S)
    return (cdata.group(1) if cdata else val).strip()


def _matches(title: str, query: str) -> bool:
    if not query:
        return True
    words = [w for w in re.split(r"[\s,/\-]+", query.lower()) if w]
    t = title.lower()
    return all(w in t for w in words)  # AND: all query words must match the title


def _normalize(block: str) -> dict:
    raw_title = _tag(block, "title")
    company, _, role = raw_title.partition(":")
    if not role:
        company, role = "", raw_title
    region = _tag(block, "region") or "Remote"
    link = _tag(block, "link")
    return {
        "id": f"wwr_{abs(hash(link or raw_title)) % 10**10}",
        "title": role.strip() or raw_title.strip(),
        "company": company.strip() or "Unknown",
        "location": region,
        "salary": "",
        "url": link,
        "apply_url": link,
        "description": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", _tag(block, "description"))).strip()[:2000],
        "source": "wwr",
        "apply_email": None,
        "tags": [t for t in _tag(block, "category").split(",") if t],
        "posted_at": _tag(block, "pubDate"),
        "remote": True,
    }


async def search(query: str = "", location: str = "", limit: int = 50) -> list[dict]:
    """Pull recent WWR remote listings across category feeds, filtered by title."""
    items: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=12, headers=_HEADERS, follow_redirects=True) as client:
            for feed in _FEEDS:
                try:
                    r = await client.get(feed)
                    if r.status_code == 200:
                        items.extend(re.findall(r"<item>(.*?)</item>", r.text, re.S))
                except Exception:
                    continue
    except Exception as exc:
        logger.warning("wwr.fetch_failed", error=str(exc))
        return []

    out, seen = [], set()
    for block in items:
        job = _normalize(block)
        if job["url"] in seen:
            continue
        seen.add(job["url"])
        if _matches(job["title"], query):
            out.append(job)
    logger.info("wwr.search_complete", query=query, returned=min(len(out), limit))
    return out[:limit]
