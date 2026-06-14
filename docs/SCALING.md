# Scaling — Playwright apply throughput

How many job applications the system can actually deliver per day, why, and the
knobs to turn — within the single-VPS / Docker-Compose / no-queue-broker
constraint (2 vCPU, 4 GB RAM). **Supersedes the earlier single-browser plan:
bounded concurrency (option b) is now shipped and made memory-safe.**

## The pipeline

```
GitHub Actions cron (*/30)  →  POST /api/cron/run-campaigns  (web, backgrounded via Next after())
   → for each campaign (fair-share ordered): scrape → eligibility/fit gates →
     POST /jobs/autoapply/careerops  (worker)  → Playwright launches chromium → submit
```

- **Web** (`app/api/cron/run-campaigns/route.ts`) decides *what* to apply to and
  sends applies with `APPLY_CONCURRENCY` parallelism.
- **Worker** (`worker/worker/routes/jobs.py`) launches chromium. It owns the
  memory limit, so it enforces the **hard** concurrency ceiling.

## Capacity model

```
appliesPerRun  = floor(concurrency × runBudgetMs / avgApplyMs)
dailyCapacity  = appliesPerRun × runsPerDay
```

Pure functions in `lib/scheduling.ts` (`appliesPerRun`, `estimateDailyCapacity`,
`isDeliverable`). The runner logs a `CAPACITY WARNING` when the sum of active
users' daily limits exceeds capacity; `scripts/throughput_sim.ts` checks it
against the tier promises.

### Knobs (current shipped values)

| Knob | Where | Default | Effect |
|---|---|---|---|
| `RUN_BUDGET_MS` | run-campaigns | 1,200,000 (20 min) | wall-clock per run |
| runs/day | `run-campaigns.yml` cron | 48 (`*/30`) | trigger frequency |
| `APPLY_CONCURRENCY` | run-campaigns (env) | **2** | parallel applies the web *sends* |
| `MAX_CONCURRENT_APPLIES` | worker (env) | **2** | **hard cap** on simultaneous chromium |
| `MIN_APPLY_MEMORY_MB` | worker (env) | 300 | refuse to launch a browser below this headroom |

Keep `APPLY_CONCURRENCY <= MAX_CONCURRENT_APPLIES` (else the web just queues at
the worker).

## Memory safety (the real ceiling)

The worker container is capped at **1500 MB** (`docker-compose.yml`
`deploy.resources.limits.memory`). Each apply launches a fresh chromium at
**~300–400 MB**:

| concurrency | browser RAM | + python/base (~300 MB) | fits 1500 MB? |
|---|---|---|---|
| 1 | ~400 MB | ~700 MB | yes (big margin) |
| **2 (shipped)** | ~800 MB | ~1100 MB | **yes (~400 MB margin)** |
| 3 | ~1200 MB | ~1500 MB | borderline — bump worker memory first |

Two guards make concurrency safe:
1. **Worker semaphore** `MAX_CONCURRENT_APPLIES` (default 2) bounds simultaneous
   browsers regardless of how many requests arrive — the deterministic ceiling.
2. **cgroup-aware memory check** (`_available_memory_mb`): reads the container's
   cgroup limit (v2 then v1), not host `/proc/meminfo` (which reports the whole
   4 GB box and would let us launch while the *container* is near its cap).

## Fair-share scheduling

Without fairness the runner processes campaigns in fetch order, so one user with
many campaigns (or first in the list) could consume the whole 20-min budget and
starve everyone else. Three mechanisms prevent it:

1. **`interleaveByUser`** (`lib/scheduling.ts`) round-robins campaigns across
   users — every user gets a turn before any user gets a second.
2. **Per-user quota distribution**: a user's remaining daily quota is split across
   their own campaigns so campaign 1 can't drain it.
3. **Adaptive per-campaign time slice**: `(RUN_BUDGET_MS − elapsed) /
   campaignsRemaining`, recomputed each campaign.

## Simulation results (`npx tsx scripts/throughput_sim.ts`)

Demand modeled: 10×Pro@25/day + 3×Unlimited@100/day = **550 applies/day**.

| concurrency | typical 20s | conservative 45s | worst-case 100s |
|---|---|---|---|
| 1 | 2,880/day (5.2×) | 1,248/day (2.3×) | 576/day (1.0×) |
| **2 (shipped)** | 5,760/day (10.5×) | **2,544/day (4.6×)** | 1,152/day (2.1×) |
| 3 | 8,640/day (15.7×) | 3,840/day (7.0×) | 1,728/day (3.1×) |

**Shipped (concurrency 2, conservative latency): 2,544 applies/day vs 550 demand
→ DELIVERABLE, 4.6× headroom.** Even worst-case latency stays above demand
(2.1×). Marketed Pro "25/day" and Unlimited are deliverable for dozens of paying
users on the current single VPS.

## When this stops being enough (in order of cost)

1. **Raise concurrency to 3** (`APPLY_CONCURRENCY=3` + `MAX_CONCURRENT_APPLIES=3`)
   *after* bumping the worker `limits.memory` to ≥ 2 GB — i.e. a VPS RAM bump
   (4 → 8 GB). Also raise `MIN_APPLY_MEMORY_MB` to ~500.
2. **Shorten `RUN_BUDGET_MS` and run the cron more often** (e.g. 10-min budget at
   `*/10` = 144 runs/day). The Redis SETNX lock prevents overlap; keep budget ≤
   cron spacing so runs aren't skipped.
3. **Vertical resize** the VPS and raise concurrency accordingly.

## Load-test / verification

```bash
npx tsx scripts/throughput_sim.ts        # capacity vs tier promises (CI-friendly, exits 1 if not deliverable)
# Live: trigger a real run and watch container memory stays under the cap:
gh workflow run run-campaigns.yml
ssh root@<vps> 'docker stats --no-stream resumeai-worker'   # peak must stay < 1500 MB
```

## Option (c) — Redis-backed continuous queue (NOT built; needs sign-off)

If (1)+(2) are still insufficient past ~100 paying users, move applies off the
cron into a continuous BullMQ worker (Redis already runs) draining a queue at a
steady rate with the same per-browser memory guard. Trade-off: a long-lived
worker process (more baseline RAM) for smooth throughput and no thundering-herd
at each cron tick. **Do not build without explicit sign-off** — single-VPS holds
well past early traction without it.
