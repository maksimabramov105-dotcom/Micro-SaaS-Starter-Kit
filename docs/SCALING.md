# Apply-throughput scaling (C1)

How the auto-apply engine scales on a single VPS, the throughput at each step,
and the exact cutover to do **the moment the VPS is resized**.

## Constraints

- **Apply cost:** a Greenhouse application takes ~60–100 s (fill → submit → poll
  inbox for the security code → resubmit). Browser concurrency is **1**.
- **Box today:** 1 vCPU / 961 MB RAM (~428 MB `MemAvailable`). A single Chromium
  uses ~300 MB, so there is **no headroom for a 2nd concurrent browser**.

## Throughput by option (applies/day, system-wide)

| Step | Cadence | RUN_BUDGET_MS | Concurrency | Applies/run | Applies/day |
|---|---|---|---|---|---|
| Before | 2 h | 600 s | 1 | ~6 | **~72** |
| **Now (a)** — shipped | 30 min | 1200 s | 1 | ~13 | **~250–600**¹ |
| After resize (b) | 30 min | 1200 s | 2–3 | ~13×N | **~1500–1800** |

¹ Ceiling is `1200/90 ≈ 13` applies/run × 48 runs/day ≈ 600; real number is lower
because runs also share time with scraping and are bounded by per-user `dailyLimit`.
Measured number from the post-deploy load test is recorded in MEMORY.

**Capacity vs users:** at ~15 applies/user/day, step (a) supports roughly
**15–40 active users**; step (b) supports **~100**.

## What shipped now (option a + safety for b)

- **Cron 2 h → 30 min** (`.github/workflows/run-campaigns.yml`) — ~4× runs/day.
- **`RUN_BUDGET_MS` 600 s → 1200 s** — ~2× applies/run; peak RAM unchanged (still 1 browser).
- **Redis SETNX lock** on `run-campaigns` — overlapping fires are skipped, so the
  shorter cadence can never start a 2nd concurrent run.
- **Worker memory guard** (`MIN_APPLY_MEMORY_MB`, default 300) — the worker
  refuses to launch a browser below the threshold; `run-campaigns` treats that
  as a transient pause (deletes the QUEUED row, stops the run) instead of a
  FAILED attempt. This is the per-context headroom check that makes (b) safe.
- **Per-source circuit breaker** — 3 consecutive failures from one ATS host stops
  applying to it for the rest of the run (anti-ban / anti-hammer).

## Cutover to option (b) — do AFTER resizing to ≥2 vCPU / 4 GB

1. **Resize the VPS** (provider action) to ≥2 vCPU / 4 GB.
2. **Raise the memory guard** so each context still gates on real headroom:
   set `MIN_APPLY_MEMORY_MB=700` in the worker env (docker-compose `worker.environment`).
3. **Parallelize the apply dispatch** (code change, not yet written — intentionally
   deferred so the proven sequential path isn't destabilized on the small box):
   in `app/api/cron/run-campaigns/route.ts`, replace the sequential
   `for (const job of scrapedJobs)` apply section with a bounded pool of
   `APPLY_CONCURRENCY` (env, default 1) workers. Each worker still: checks budget,
   quota (`canSendApplication`), the fit gate, eligibility, dedup, then calls
   `careeropsApply`. The worker memory guard already prevents the Nth browser from
   spawning without headroom, so the pool degrades gracefully.
4. Set `APPLY_CONCURRENCY=3`.
5. **Load test:** trigger `POST /api/cron/run-campaigns`, watch
   `docker stats` — peak container memory must stay < ~80 % of RAM, and
   `free -h` `available` must not approach 0. Confirm no source returns 429/ban
   (check worker logs for the per-source breaker tripping).

## Option (c) — Redis-backed continuous queue (NOT built; needs sign-off)

If (a)+(b) are still insufficient at 100 users, move applies off the 2-bursts-per-hour
cron into a continuous BullMQ worker (Redis already runs) that drains a queue at a
steady rate with the same per-context memory guard. Trade-offs: a long-lived worker
process (more baseline RAM), more moving parts to monitor, but smooth throughput and
no thundering-herd at each cron tick. **Do not build without explicit sign-off.**
