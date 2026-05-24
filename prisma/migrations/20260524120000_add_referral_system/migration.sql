-- CreateTable: Referral + extend User with referral fields
-- Prompt 07: double-sided $20 referral program

-- Add referral fields to User
ALTER TABLE "User"
  ADD COLUMN "referralCode"   TEXT,
  ADD COLUMN "referralCount"  INTEGER   NOT NULL DEFAULT 0,
  ADD COLUMN "referralEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "referredById"   TEXT;

-- Unique index for referral code
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- Index for referralCode lookups
CREATE INDEX "User_referralCode_idx" ON "User"("referralCode");

-- Self-referral FK (referredBy)
ALTER TABLE "User"
  ADD CONSTRAINT "User_referredById_fkey"
    FOREIGN KEY ("referredById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable Referral
CREATE TABLE "Referral" (
    "id"                     TEXT         NOT NULL,
    "referrerId"             TEXT         NOT NULL,
    "refereeId"              TEXT         NOT NULL,
    "status"                 TEXT         NOT NULL DEFAULT 'pending',
    "stripeCouponReferrerId" TEXT,
    "stripeCouponRefereeId"  TEXT,
    "qualifiedAt"            TIMESTAMP(3),
    "rewardedAt"             TIMESTAMP(3),
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- Referee uniqueness (one referral per referee)
CREATE UNIQUE INDEX "Referral_refereeId_key" ON "Referral"("refereeId");

-- FK: referrerId → User
ALTER TABLE "Referral"
  ADD CONSTRAINT "Referral_referrerId_fkey"
    FOREIGN KEY ("referrerId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: refereeId → User
ALTER TABLE "Referral"
  ADD CONSTRAINT "Referral_refereeId_fkey"
    FOREIGN KEY ("refereeId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "Referral_referrerId_idx" ON "Referral"("referrerId");
CREATE INDEX "Referral_status_idx"     ON "Referral"("status");
