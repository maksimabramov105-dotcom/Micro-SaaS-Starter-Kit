-- Win-back: schedule a re-engagement email when a user cancels, fired once when
-- they likely re-enter the job market. All additive + nullable.
ALTER TABLE "User"
  ADD COLUMN "winBackAt" TIMESTAMP(3),
  ADD COLUMN "winBackSentAt" TIMESTAMP(3);

CREATE INDEX "User_winBackAt_idx" ON "User"("winBackAt");
