-- Remove legacy hh.ru (HeadHunter) OAuth columns.
-- These were imported from the legacy autoapply DB but the hh.ru integration
-- was never shipped. Columns have been NULL in production since day one.
-- Safe to drop: no application code reads or writes them.

ALTER TABLE "AutoApplyCampaign" DROP COLUMN IF EXISTS "hhToken";
ALTER TABLE "AutoApplyCampaign" DROP COLUMN IF EXISTS "hhResumeId";
