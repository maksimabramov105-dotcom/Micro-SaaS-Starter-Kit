-- P3.2: persist the per-factor fit breakdown so the user-facing fit report can
-- EXPLAIN the score (skills / seniority / eligibility / language) instead of
-- just asserting a number. Nullable on purpose: every row scored before this
-- migration keeps working and simply renders without the per-factor bars.
ALTER TABLE "JobApplication" ADD COLUMN "fitBreakdown" JSONB;
