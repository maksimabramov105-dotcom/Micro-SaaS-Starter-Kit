"""
Browser concurrency guards on the apply routes.

WHY: MAX_CONCURRENT_APPLIES was documented as "the HARD ceiling" on simultaneous
chromium processes, but it only ever wrapped /autoapply/careerops.
/autoapply/linkedin launches chromium too and had no bound and no memory check,
so the ceiling applied to one of the two ways we start a browser.

Observed 2026-08-01 in production: nine concurrent chromiums drove the host to
load 32 with 67 MB of 3.8 GB free. The web container, the health endpoint and
SSH all became unreachable — a worker problem took down the entire site.

These tests assert the properties that make that impossible, without launching a
real browser: every apply route acquires the shared semaphore, and every apply
route refuses to start when memory is short.
"""
import asyncio
import inspect

import pytest

from worker.routes import jobs as jobs_module

APPLY_ROUTES = ["autoapply_careerops", "autoapply_linkedin"]


@pytest.mark.parametrize("name", APPLY_ROUTES)
def test_every_apply_route_acquires_the_shared_semaphore(name):
    src = inspect.getsource(getattr(jobs_module, name))
    assert "_APPLY_SEMAPHORE" in src, (
        f"{name} launches a browser without the concurrency ceiling — this is "
        "exactly the gap that took the host down on 2026-08-01"
    )


@pytest.mark.parametrize("name", APPLY_ROUTES)
def test_every_apply_route_checks_memory_before_launching(name):
    src = inspect.getsource(getattr(jobs_module, name))
    assert "_available_memory_mb" in src
    assert "MIN_APPLY_MEMORY_MB" in src


@pytest.mark.parametrize("name", APPLY_ROUTES)
def test_memory_is_checked_inside_the_semaphore_not_before_it(name):
    # Order matters: checking headroom before acquiring means every waiter
    # measures the same pre-launch memory and they all decide there is room.
    src = inspect.getsource(getattr(jobs_module, name))
    assert src.index("_APPLY_SEMAPHORE") < src.index("_available_memory_mb")


def test_the_ceiling_is_small_enough_for_the_box():
    # Each chromium is ~300-400 MB against a 1500 MB container cap.
    assert 1 <= jobs_module.MAX_CONCURRENT_APPLIES <= 3


def test_the_semaphore_is_shared_not_per_route():
    # Two semaphores of 2 would permit 4 browsers, which is the same bug with
    # extra steps.
    assert isinstance(jobs_module._APPLY_SEMAPHORE, asyncio.Semaphore)
    src = inspect.getsource(jobs_module)
    assert src.count("_APPLY_SEMAPHORE = asyncio.Semaphore") == 1


def test_semaphore_actually_bounds_concurrency():
    """The ceiling holds under more simultaneous callers than slots."""
    peak = 0
    live = 0

    async def worker():
        nonlocal peak, live
        async with jobs_module._APPLY_SEMAPHORE:
            live += 1
            peak = max(peak, live)
            await asyncio.sleep(0.01)
            live -= 1

    async def main():
        await asyncio.gather(*(worker() for _ in range(10)))

    asyncio.run(main())
    assert peak <= jobs_module.MAX_CONCURRENT_APPLIES
