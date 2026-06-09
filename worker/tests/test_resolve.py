"""Tests for the board-listing → fillable-ATS URL resolver."""
import httpx
import pytest
import respx

from worker.scrapers.resolve import _is_fillable, resolve_one, resolve_many


def test_is_fillable_classifies_hosts():
    assert _is_fillable("https://boards.greenhouse.io/acme/jobs/123")
    assert _is_fillable("https://jobs.lever.co/acme/abc")
    assert _is_fillable("https://apply.workable.com/acme/j/123")
    # Boards / Ashby are NOT fillable targets.
    assert not _is_fillable("https://remoteok.com/remote-jobs/123")
    assert not _is_fillable("https://jobs.ashbyhq.com/acme/123")
    assert not _is_fillable("https://example.com/careers")


@pytest.mark.asyncio
async def test_resolve_one_returns_fillable_input_without_fetch():
    # Already fillable → returned as-is (no network needed).
    async with httpx.AsyncClient() as client:
        out = await resolve_one(client, "https://boards.greenhouse.io/acme/jobs/9")
    assert out == "https://boards.greenhouse.io/acme/jobs/9"


@pytest.mark.asyncio
@respx.mock
async def test_resolve_one_scans_listing_html_for_ats_link():
    html = (
        '<html><body><a href="https://x">x</a>'
        '<a href="https://jobs.lever.co/acme/deadbeef/apply">Apply</a>'
        '</body></html>'
    )
    respx.get("https://weworkremotely.com/remote-jobs/acme-support").mock(
        return_value=httpx.Response(200, text=html, headers={"content-type": "text/html"})
    )
    async with httpx.AsyncClient() as client:
        out = await resolve_one(client, "https://weworkremotely.com/remote-jobs/acme-support")
    assert out == "https://jobs.lever.co/acme/deadbeef/apply"


@pytest.mark.asyncio
@respx.mock
async def test_resolve_one_returns_none_when_no_ats_link():
    respx.get("https://remoteok.com/remote-jobs/123").mock(
        return_value=httpx.Response(200, text="<html>no ats here</html>",
                                    headers={"content-type": "text/html"})
    )
    async with httpx.AsyncClient() as client:
        out = await resolve_one(client, "https://remoteok.com/remote-jobs/123")
    assert out is None


@pytest.mark.asyncio
@respx.mock
async def test_resolve_many_batches_and_dedupes():
    respx.get("https://himalayas.app/jobs/x").mock(
        return_value=httpx.Response(
            200,
            text='<a href="https://acme.smartrecruiters.com/job/1">apply</a>',
            headers={"content-type": "text/html"},
        )
    )
    out = await resolve_many(["https://himalayas.app/jobs/x", "https://himalayas.app/jobs/x", ""])
    assert out["https://himalayas.app/jobs/x"] == "https://acme.smartrecruiters.com/job/1"
