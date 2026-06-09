"""
resolve.py — Board-listing → fillable-ATS URL resolver.

Aggregator boards (RemoteOK, We Work Remotely, Himalayas, The Muse, Adzuna)
surface huge volumes of remote roles, but their apply_url is a *listing* page
that CareerOps cannot fill. Most of those listings, however, either redirect to
or link out to a real ATS application page (Greenhouse / Lever / Workable /
SmartRecruiters / Recruitee / Jobvite) that CareerOps CAN fill.

This resolver takes a board URL and tries to return a fillable ATS URL by:
  1. Following HTTP redirects (handles e.g. remoteok.com/l/<id> → real apply URL).
  2. If the final URL is already a fillable ATS, return it.
  3. Otherwise, if the page is HTML, scan it for the first fillable ATS link.

Ashby (jobs.ashbyhq.com) is deliberately NOT treated as fillable — its apply
page is a client-only SPA that renders empty headless (see run-campaigns notes),
so resolving *to* Ashby would just produce another unfillable URL.
"""
import asyncio
import re

import httpx
import structlog

logger = structlog.get_logger(__name__)

_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ResumeAI-Worker/1.0)"}

# Hosts whose application pages the CareerOps engine can fill (Ashby excluded).
_FILLABLE = re.compile(
    r"(greenhouse\.io|grnh\.se|jobs\.lever\.co|lever\.co|"
    r"apply\.workable\.com|workable\.com|smartrecruiters\.com|"
    r"recruitee\.com|jobs\.jobvite\.com|jobvite\.com)",
    re.I,
)

# Board hosts — a "resolved" URL that is still one of these is not progress.
_BOARD = re.compile(
    r"(remoteok\.com|weworkremotely\.com|himalayas\.app|themuse\.com|"
    r"adzuna\.|arbeitnow\.com|remotive\.com|jobs\.ashbyhq\.com)",
    re.I,
)

_URL_RE = re.compile(r'https?://[^\s"\'<>\\)]+', re.I)


def _is_fillable(url: str) -> bool:
    return bool(_FILLABLE.search(url)) and not bool(_BOARD.search(url))


async def resolve_one(client: httpx.AsyncClient, url: str) -> str | None:
    """Return a fillable ATS URL for a board listing, or None if none found."""
    if not url:
        return None
    if _is_fillable(url):
        return url
    try:
        r = await client.get(url, follow_redirects=True)
        final = str(r.url)
        if _is_fillable(final):
            return final
        ctype = r.headers.get("content-type", "")
        if "html" in ctype and r.text:
            # Scan the listing HTML for the first fillable ATS link.
            for m in _URL_RE.finditer(r.text):
                cand = m.group(0).rstrip('",\')')
                if _is_fillable(cand):
                    return cand
    except Exception as exc:
        logger.info("resolve.failed", url=url[:80], error=str(exc)[:120])
    return None


async def resolve_many(urls: list[str], concurrency: int = 6, timeout: float = 8.0) -> dict[str, str | None]:
    """Resolve a batch of board URLs to fillable ATS URLs (bounded concurrency)."""
    out: dict[str, str | None] = {}
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(timeout=timeout, headers=_HEADERS) as client:
        async def _go(u: str) -> None:
            async with sem:
                out[u] = await resolve_one(client, u)
        await asyncio.gather(*[_go(u) for u in dict.fromkeys(u for u in urls if u)])
    return out
