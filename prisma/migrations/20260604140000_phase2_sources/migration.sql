-- Phase 2: new JobSource values for the Top-10 sourcing adapters, plus
-- per-source feature flags (enabled by default at 100%). Additive + idempotent.

-- New enum values (Postgres 16 allows ADD VALUE inside a transaction; the values
-- are not USED in this migration, only declared, so this is safe).
ALTER TYPE "JobSource" ADD VALUE IF NOT EXISTS 'HIMALAYAS';
ALTER TYPE "JobSource" ADD VALUE IF NOT EXISTS 'WWR';
ALTER TYPE "JobSource" ADD VALUE IF NOT EXISTS 'RECRUITEE';
ALTER TYPE "JobSource" ADD VALUE IF NOT EXISTS 'PERSONIO';

-- Per-source enable flags. Each source can be toggled independently so adding
-- one never destabilizes another. Seeded enabled at 100% rollout.
INSERT INTO "FeatureFlag" ("key", "enabled", "rolloutPct", "description", "updatedAt") VALUES
  ('source_remoteok',  true, 100, 'Phase 2: RemoteOK sourcing',  now()),
  ('source_himalayas', true, 100, 'Phase 2: Himalayas sourcing', now()),
  ('source_wwr',       true, 100, 'Phase 2: We Work Remotely sourcing', now()),
  ('source_lever',     true, 100, 'Phase 2: Lever ATS sourcing', now()),
  ('source_ashby',     true, 100, 'Phase 2: Ashby ATS sourcing', now()),
  ('source_recruitee', true, 100, 'Phase 2: Recruitee ATS sourcing', now()),
  ('source_personio',  true, 100, 'Phase 2: Personio ATS sourcing', now())
ON CONFLICT ("key") DO NOTHING;
