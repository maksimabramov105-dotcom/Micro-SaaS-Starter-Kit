# Task 2 — System audit + "won't break at 100 users" (code-verified)

Covers your opening ask: is it built right, will it survive 100 users, does SEO work, is it marketing-ready. Scoped for one person + Claude Code.




VPS resize (P0 #2) → ≥2 vCPU / 4GB. It's the real 100-user ceiling and the only item I can't execute (hosting action + cost). The moment you resize, the cutover is fully documented in docs/SCALING.md (raise MIN_APPLY_MEMORY_MB, parallelize the apply loop behind APPLY_CONCURRENCY, set it to 3, load-test) — I can apply that in one PR on your go-ahead.



### 
platform — Sentry + the admin funnel view are enough pre-revenue. ✅ Do C1 throughput, C2 lock, C3 SEO verify, C4 trust.
