-- Phase 3: job-fit score (0–100) + reasons, cached on JobListing and copied to
-- JobApplication at apply time for dashboard display. All additive.
ALTER TABLE "JobListing"
  ADD COLUMN "fitScore" INTEGER,
  ADD COLUMN "fitReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "JobApplication"
  ADD COLUMN "fitScore" INTEGER,
  ADD COLUMN "fitReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Job-fit threshold flag (applications below this score are skipped). Seeded
-- enabled; rolloutPct doubles as the threshold read by the orchestrator.
INSERT INTO "FeatureFlag" ("key", "enabled", "rolloutPct", "description", "updatedAt")
VALUES ('jobfit_min_score', true, 45, 'Phase 3: minimum job-fit score (0-100) to auto-apply', now())
ON CONFLICT ("key") DO NOTHING;
