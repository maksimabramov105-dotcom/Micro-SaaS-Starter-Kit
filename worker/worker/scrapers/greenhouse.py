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

# Curated for INTERVIEW PROBABILITY, not raw volume (2026-06-15). These are
# mid-market, support/CX/ops-heavy, and/or global-remote companies where a solid
# non-elite candidate (e.g. a few years' experience, no FAANG pedigree) has a
# REAL shot at an interview. We deliberately DROPPED FAANG / top AI labs / top
# fintech / prestige unicorns (Stripe, Anthropic, Airbnb, Figma, Coinbase,
# Databricks, Datadog, Cloudflare, MongoDB, Brex, Reddit, Discord, Pinterest,
# Lyft, etc.) — even their support roles draw thousands of applicants and a very
# high bar, so applying there just burns shots. All entries verified live.
_COMPANIES: list[str] = [
    # Mid-market SaaS with real support/CX/ops volume
    "gitlab", "elastic", "twilio", "intercom", "gusto", "contentful", "algolia",
    "customerio", "mattermost", "webflow", "calendly", "airtable", "postman",
    "fivetran", "hightouch", "huntress", "mercury", "checkr", "turing", "circleci",
    "cockroachlabs", "typeform", "dialpad", "lattice", "cultureamp", "justworks",
    "payoneer", "gocardless", "truelayer", "modernhealth", "later", "hootsuite",
    "klaviyo", "cargurus", "pushpay", "fingerprint", "planetscale", "octopusdeploy",
    "asana", "flexport", "faire", "amplitude", "squarespace", "verkada",
    "smartsheet", "chime", "udemy", "carta", "betterment", "guild", "coursera",
    "masterclass", "cerebral", "cameo", "calm",
    # Global-remote-first / EOR (hire from anywhere incl APAC/NZ) — best eligible
    # pool for non-US candidates.
    "canonical", "remotecom", "remote", "grafanalabs",
    # More mid-market support/ops (non-elite), verified live.
    "getyourguide", "current", "mercari",
    # 2026-06-28 supply expansion — verified boards with AU-eligible/global-remote roles.
    "vercel", "nextiva", "eucalyptus",
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
