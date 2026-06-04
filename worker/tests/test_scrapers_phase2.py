"""
test_scrapers_phase2.py — Unit tests for the Phase 2 sourcing adapters.

Uses respx to mock the feeds so no real network calls are made. Each test
asserts the normalized dict shape (the keys run-campaigns relies on) plus the
source-specific fields: source, apply_url, remote, posted_at.
"""
import httpx
import pytest
import respx


def _assert_shape(job: dict, source: str):
    for key in ("id", "title", "company", "location", "salary", "url",
                "apply_url", "description", "source", "tags", "posted_at", "remote"):
        assert key in job, f"missing key {key}"
    assert job["source"] == source


# ── Himalayas ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@respx.mock
async def test_himalayas_normalizes():
    respx.get(url__regex=r"https://himalayas\.app/jobs/api.*").mock(
        return_value=httpx.Response(200, json={"jobs": [
            {"title": "Senior Python Engineer", "companyName": "Acme",
             "companySlug": "acme", "applicationLink": "https://acme.com/apply",
             "locationRestrictions": ["USA", "Canada"], "pubDate": 1717000000,
             "description": "<p>Build things</p>", "categories": ["Engineering"]},
            {"title": "Marketing Lead", "companyName": "Beta", "companySlug": "beta",
             "applicationLink": "https://beta.com/apply", "locationRestrictions": [],
             "pubDate": 1717000000, "description": "x"},
        ]})
    )
    from worker.scrapers.himalayas import search
    res = await search(query="python")
    assert len(res) == 1  # title filter drops "Marketing Lead"
    _assert_shape(res[0], "himalayas")
    assert res[0]["remote"] is True
    assert res[0]["apply_url"] == "https://acme.com/apply"
    assert res[0]["posted_at"]


# ── We Work Remotely ─────────────────────────────────────────────────────────

WWR_RSS = """<?xml version="1.0"?><rss><channel>
<item><title>Acme: Senior Backend Engineer</title><region>Anywhere in the World</region>
<link>https://weworkremotely.com/remote-jobs/acme-eng</link>
<pubDate>Mon, 02 Jun 2026 10:00:00 +0000</pubDate><category>Programming</category>
<description>&lt;p&gt;Join us&lt;/p&gt;</description></item>
<item><title>Beta: Sales Rep</title><region>USA Only</region>
<link>https://weworkremotely.com/remote-jobs/beta-sales</link>
<pubDate>Mon, 02 Jun 2026 10:00:00 +0000</pubDate><category>Sales</category>
<description>x</description></item>
</channel></rss>"""


@pytest.mark.asyncio
@respx.mock
async def test_wwr_normalizes_and_splits_company():
    respx.get(url__regex=r"https://weworkremotely\.com/.*\.rss").mock(
        return_value=httpx.Response(200, text=WWR_RSS)
    )
    from worker.scrapers.wwr import search
    res = await search(query="engineer")
    assert len(res) == 1
    job = res[0]
    _assert_shape(job, "wwr")
    assert job["company"] == "Acme"
    assert job["title"] == "Senior Backend Engineer"
    assert job["remote"] is True


# ── Lever ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@respx.mock
async def test_lever_normalizes():
    respx.get(url__regex=r"https://api\.lever\.co/v0/postings/.*").mock(
        return_value=httpx.Response(200, json=[
            {"id": "abc123", "text": "Backend Engineer",
             "hostedUrl": "https://jobs.lever.co/acme/abc123",
             "categories": {"location": "Remote", "team": "Eng"},
             "workplaceType": "remote", "createdAt": 1717000000000},
        ])
    )
    from worker.scrapers.lever import search
    res = await search(query="engineer")
    assert len(res) >= 1
    job = res[0]
    _assert_shape(job, "lever")
    assert "jobs.lever.co" in job["apply_url"]
    assert job["remote"] is True
    assert job["posted_at"]


# ── Ashby ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@respx.mock
async def test_ashby_normalizes():
    respx.get(url__regex=r"https://api\.ashbyhq\.com/posting-api/job-board/.*").mock(
        return_value=httpx.Response(200, json={"jobs": [
            {"id": "j1", "title": "Platform Engineer", "location": "Remote - US",
             "isRemote": True, "workplaceType": "Remote", "publishedAt": "2026-06-02T10:00:00Z",
             "jobUrl": "https://jobs.ashbyhq.com/acme/j1",
             "applyUrl": "https://jobs.ashbyhq.com/acme/j1/application", "isListed": True},
        ], "apiVersion": "1"})
    )
    from worker.scrapers.ashby import search
    res = await search(query="engineer")
    assert len(res) >= 1
    job = res[0]
    _assert_shape(job, "ashby")
    assert "jobs.ashbyhq.com" in job["apply_url"]
    assert job["remote"] is True


# ── Recruitee ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@respx.mock
async def test_recruitee_normalizes():
    respx.get(url__regex=r"https://.*\.recruitee\.com/api/offers/").mock(
        return_value=httpx.Response(200, json={"offers": [
            {"id": 7, "title": "Software Engineer", "location": "Amsterdam, NL",
             "careers_apply_url": "https://acme.recruitee.com/o/software-engineer",
             "department": "Engineering", "published_at": "2026-06-02T00:00:00Z"},
        ]})
    )
    from worker.scrapers.recruitee import search
    res = await search(query="engineer")
    assert len(res) >= 1
    job = res[0]
    _assert_shape(job, "recruitee")
    assert "recruitee.com" in job["apply_url"]


# ── Personio ─────────────────────────────────────────────────────────────────

PERSONIO_XML = """<?xml version="1.0"?><workzag-jobs>
<position><id>555</id><office>Munich</office><department>Engineering</department>
<recruitingCategory>Eng</recruitingCategory><name>Senior Software Engineer</name>
<jobDescriptions><jobDescription><name>Role</name><value>Do things</value></jobDescription></jobDescriptions>
</position></workzag-jobs>"""


@pytest.mark.asyncio
@respx.mock
async def test_personio_parses_xml_and_skips_html():
    # Real XML response → parsed.
    respx.get(url__regex=r"https://.*\.jobs\.personio\.de/xml.*").mock(
        return_value=httpx.Response(200, text=PERSONIO_XML,
                                    headers={"content-type": "text/xml"})
    )
    from worker.scrapers.personio import search
    res = await search(query="engineer")
    assert len(res) >= 1
    job = res[0]
    _assert_shape(job, "personio")
    assert job["title"] == "Senior Software Engineer"
    assert "jobs.personio.de/job/555" in job["apply_url"]


@pytest.mark.asyncio
@respx.mock
async def test_personio_skips_bot_challenge_html():
    # Bot-protection HTML challenge → skipped (no XML content-type).
    respx.get(url__regex=r"https://.*\.jobs\.personio\.de/xml.*").mock(
        return_value=httpx.Response(200, text="<html>checkpoint</html>",
                                    headers={"content-type": "text/html"})
    )
    from worker.scrapers.personio import search
    res = await search(query="engineer")
    assert res == []
