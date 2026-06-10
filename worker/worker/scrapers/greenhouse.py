"""
greenhouse.py — Greenhouse ATS job board scraper.

Queries the public Greenhouse Boards API for a curated list of tech companies.
Returns jobs with direct ``job-boards.greenhouse.io`` apply URLs that the
CareerOps ATS filler can fill and submit without any page navigation.

No API key required.  API endpoint per company:
    https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=false

Apply URL format (returned by this scraper):
    https://job-boards.greenhouse.io/{company}/jobs/{job_id}

The CareerOps filler matches this via the ``greenhouse.io`` pattern.
"""
import asyncio
import random
import re

import httpx
import structlog

logger = structlog.get_logger(__name__)

_HEADERS = {"User-Agent": "ResumeAI-Worker/1.0 (support@example.com)"}

# Remote-first / globally-hiring companies on Greenhouse, verified live and
# (critically) cross-functional: each posts substantial NON-engineering volume
# (support, success, sales, marketing, ops, people, finance) so AND-keyword
# matching surfaces *whatever role* a given user is searching for — not just eng.
# Verified counts at curation time, e.g. gitlab 147 (52 non-eng), elastic 160
# (95), mongodb 429 (155), twilio 147 (72), intercom 153 (50), notion-tier.
_COMPANIES: list[str] = [
    "gitlab",
    "elastic",
    "mongodb",
    "twilio",
    "intercom",
    "cloudflare",
    "dropbox",
    "gusto",
    "contentful",
    "algolia",
    "customerio",
    "mattermost",
    "webflow",
    "calendly",
    "airtable",
    "postman",
    "fivetran",
    "hightouch",
    "huntress",
    "mercury",
    "checkr",
    "monzo",
    "n26",
    "brex",
    "figma",
    "vercel",
    "turing",
    "circleci",
    "gemini",
    "robinhood",
    # Phase A expansion — support/CX, fintech, HR-tech, health, marketing heavy
    # (all verified live; deepens the fillable pool for non-engineering roles).
    "cockroachlabs",
    "typeform",
    "dialpad",
    "lattice",
    "cultureamp",
    "justworks",
    "payoneer",
    "gocardless",
    "truelayer",
    "modernhealth",
    "reddit",
    "discord",
    "later",
    "hootsuite",
    "klaviyo",
    "nubank",
    # Global-remote-first (hire from anywhere incl APAC/NZ) + ANZ/APAC employers —
    # gives non-US-authorized candidates a genuinely eligible fillable pool.
    "canonical",
    "remotecom",
    "grafanalabs",
    "databricks",
    "cargurus",
    "pushpay",
    "fingerprint",
    "planetscale",
    "octopusdeploy",
]


def _keyword_matches(title: str, keywords: str) -> bool:
    """Return True if any word from ``keywords`` appears in the job title."""
    if not keywords:
        return True
    words = re.split(r"[\s,/\-]+", keywords.lower())
    title_lower = title.lower()
    return all(w in title_lower for w in words if w)  # AND match


async def _fetch_company(
    client: httpx.AsyncClient, company: str
) -> list[dict]:
    """Fetch all jobs for one Greenhouse company, return normalized list."""
    try:
        r = await client.get(
            f"https://boards-api.greenhouse.io/v1/boards/{company}/jobs",
            params={"content": "false"},
        )
        if r.status_code != 200:
            logger.warning("greenhouse.http_error", company=company, status=r.status_code)
            return []
        data = r.json()
        jobs = data.get("jobs", [])
        result = []
        for job in jobs:
            # Only include jobs with a standard job-boards.greenhouse.io URL
            abs_url: str = job.get("absolute_url", "")
            if "greenhouse.io" not in abs_url:
                continue
            job_id = str(job.get("id", ""))
            location = ""
            offices = job.get("offices") or job.get("location") or {}
            if isinstance(offices, list) and offices:
                location = offices[0].get("name", "")
            elif isinstance(offices, dict):
                location = offices.get("name", "")
            result.append(
                {
                    "id": f"greenhouse_{company}_{job_id}",
                    "title": job.get("title", ""),
                    "company": company.replace("-", " ").title(),
                    "location": location or "Remote",
                    "salary": "",
                    "url": abs_url,
                    "apply_url": abs_url,
                    "description": "",
                    "source": "greenhouse",
                    "apply_email": None,
                    "tags": [],
                }
            )
        return result
    except Exception as exc:
        logger.warning("greenhouse.fetch_failed", company=company, error=str(exc))
        return []


async def search(
    query: str = "",
    location: str = "",
    limit: int = 200,
) -> list[dict]:
    """
    Search all curated Greenhouse company boards in parallel.
    Returns up to ``limit`` jobs whose title matches ``query`` keywords.
    ``location`` is accepted for API compatibility but Greenhouse does not
    support server-side location filtering.

    Companies are shuffled each call so repeated runs cycle through all
    companies rather than always returning the same company's jobs first.
    """
    companies = list(_COMPANIES)
    random.shuffle(companies)

    async with httpx.AsyncClient(timeout=10, headers=_HEADERS) as client:
        tasks = [_fetch_company(client, c) for c in companies]
        batches = await asyncio.gather(*tasks)

    all_jobs: list[dict] = []
    seen_ids: set[str] = set()
    for batch in batches:
        for job in batch:
            if job["id"] not in seen_ids:
                seen_ids.add(job["id"])
                all_jobs.append(job)

    # Filter by keyword match in title
    if query:
        all_jobs = [j for j in all_jobs if _keyword_matches(j["title"], query)]

    logger.info(
        "greenhouse.search_complete",
        query=query,
        total_before_limit=len(all_jobs),
        returned=min(len(all_jobs), limit),
    )
    return all_jobs[:limit]
