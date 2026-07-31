-- Add EXTENSION to JobSource.
--
-- Applications the user tracks themselves through the Chrome extension were
-- being written as MANUAL, which made them indistinguishable from hand-entered
-- rows. Phase 2's whole premise is that the extension is the distribution
-- wedge, and it cannot be evaluated if its contribution is unmeasurable.
ALTER TYPE "JobSource" ADD VALUE IF NOT EXISTS 'EXTENSION';
