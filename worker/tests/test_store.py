"""
test_store.py — Tests for Redis-backed job store and tailor cache.

These tests use respx/pytest monkeypatching to avoid a real Redis connection.
Both behaviours are tested:
  1. jobs.py — job persisted at creation (status="running"), then updated at completion.
  2. tailor.py — cache miss hits Redis; cache hit returns local value; Redis errors are silent.
"""
import json
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── helpers ───────────────────────────────────────────────────────────────────


def _make_redis_mock(get_return: str | None = None) -> MagicMock:
    """Return a mock that behaves like `async with aioredis.from_url(...) as r`."""
    r = AsyncMock()
    r.get = AsyncMock(return_value=get_return)
    r.setex = AsyncMock(return_value=True)

    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=r)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm, r


# ── jobs.py: _redis_save / _new_job ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_new_job_saves_to_redis_at_creation():
    """_new_job() must persist a 'running' record to Redis immediately."""
    from worker.routes.jobs import _new_job

    cm, r = _make_redis_mock()

    with (
        patch("worker.routes.jobs.settings") as mock_settings,
        patch("worker.routes.jobs.aioredis.from_url", return_value=cm),
    ):
        mock_settings.redis_url = "redis://localhost:6379"

        job = await _new_job()

    assert job.status == "running"
    assert job.job_id
    r.setex.assert_awaited_once()
    key_arg, ttl_arg, payload_arg = r.setex.call_args.args
    assert key_arg == f"job:{job.job_id}"
    assert ttl_arg == 86_400
    data = json.loads(payload_arg)
    assert data["status"] == "running"
    assert data["job_id"] == job.job_id


@pytest.mark.asyncio
async def test_new_job_no_redis_url_does_not_raise():
    """_new_job() must succeed even when redis_url is empty."""
    from worker.routes.jobs import _new_job

    with patch("worker.routes.jobs.settings") as mock_settings:
        mock_settings.redis_url = ""
        job = await _new_job()

    assert job.status == "running"


@pytest.mark.asyncio
async def test_redis_save_is_silent_on_connection_error():
    """_redis_save() must not raise when Redis is unreachable."""
    from worker.routes.jobs import JobRecord, _redis_save

    job = JobRecord(
        job_id="test-id",
        status="done",
        created_at=datetime.now(timezone.utc),
    )

    broken_cm = MagicMock()
    broken_cm.__aenter__ = AsyncMock(side_effect=ConnectionRefusedError("refused"))
    broken_cm.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("worker.routes.jobs.settings") as mock_settings,
        patch("worker.routes.jobs.aioredis.from_url", return_value=broken_cm),
    ):
        mock_settings.redis_url = "redis://localhost:6379"
        # Must not raise
        await _redis_save(job)


# ── tailor.py: _get_cached / _set_cached ─────────────────────────────────────


@pytest.mark.asyncio
async def test_tailor_cache_miss_reads_redis():
    """Cache miss in local dict should fall through to Redis."""
    from worker.ai import tailor

    # Ensure local cache is empty for this key
    tailor._CACHE.clear()

    cached_value = [{"name": "Alice"}, 100, "gpt-4o-mini"]
    cm, r = _make_redis_mock(get_return=json.dumps(cached_value))

    with (
        patch("worker.ai.tailor.settings") as mock_settings,
        patch("worker.ai.tailor.aioredis.from_url", return_value=cm),
    ):
        mock_settings.redis_url = "redis://localhost:6379"
        result = await tailor._get_cached("deadbeef" * 8)

    assert result == cached_value
    r.get.assert_awaited_once()


@pytest.mark.asyncio
async def test_tailor_cache_hit_skips_redis():
    """Local fast-path hit must NOT round-trip to Redis."""
    from worker.ai import tailor
    import time

    key = "localfastpath" + "x" * 51
    tailor._CACHE[key] = ({"name": "Bob"}, time.time())  # fresh local entry

    with patch("worker.ai.tailor.aioredis.from_url") as mock_from_url:
        result = await tailor._get_cached(key)

    assert result == {"name": "Bob"}
    mock_from_url.assert_not_called()

    # Clean up
    del tailor._CACHE[key]


@pytest.mark.asyncio
async def test_tailor_set_cached_writes_redis():
    """_set_cached() must write to both local dict and Redis."""
    from worker.ai import tailor

    tailor._CACHE.clear()
    cm, r = _make_redis_mock()
    key = "settest" + "0" * 57

    with (
        patch("worker.ai.tailor.settings") as mock_settings,
        patch("worker.ai.tailor.aioredis.from_url", return_value=cm),
    ):
        mock_settings.redis_url = "redis://localhost:6379"
        await tailor._set_cached(key, {"x": 1})

    assert key in tailor._CACHE
    r.setex.assert_awaited_once()
    rkey, ttl, payload = r.setex.call_args.args
    assert rkey == f"tailor:{key}"
    assert ttl == tailor._CACHE_TTL
    assert json.loads(payload) == {"x": 1}

    del tailor._CACHE[key]


@pytest.mark.asyncio
async def test_tailor_redis_error_is_silent():
    """Redis errors in _get_cached / _set_cached must not propagate."""
    from worker.ai import tailor

    tailor._CACHE.clear()

    broken_cm = MagicMock()
    broken_cm.__aenter__ = AsyncMock(side_effect=OSError("Redis down"))
    broken_cm.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("worker.ai.tailor.settings") as mock_settings,
        patch("worker.ai.tailor.aioredis.from_url", return_value=broken_cm),
    ):
        mock_settings.redis_url = "redis://localhost:6379"
        result = await tailor._get_cached("anykey" + "0" * 58)
        assert result is None  # miss, no raise

        await tailor._set_cached("anykey" + "0" * 58, {"v": 2})  # no raise


@pytest.mark.asyncio
async def test_tailor_redis_url_db2():
    """_tailor_redis_url() must append /2 to the base URL."""
    from worker.ai.tailor import _tailor_redis_url

    with patch("worker.ai.tailor.settings") as mock_settings:
        mock_settings.redis_url = "redis://redis:6379"
        assert _tailor_redis_url() == "redis://redis:6379/2"

        mock_settings.redis_url = "redis://redis:6379/1"
        assert _tailor_redis_url() == "redis://redis:6379/2"

        mock_settings.redis_url = ""
        assert _tailor_redis_url() == ""
