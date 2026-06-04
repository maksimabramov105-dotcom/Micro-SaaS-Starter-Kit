-- Phase 1: eligibility profile on AutoApplyCampaign.
-- Drives honest work-authorization / sponsorship / relocation screening answers
-- and the pre-apply knockout filter. All columns are additive with safe defaults,
-- so existing rows are unaffected (remoteOnly defaults to true → existing campaigns
-- become remote-only until the user opts into on-site).
ALTER TABLE "AutoApplyCampaign"
  ADD COLUMN "authorizedCountries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "needsVisaSponsorship" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "willingToRelocate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "remoteOnly" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
