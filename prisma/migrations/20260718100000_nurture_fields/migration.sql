-- AlterTable
ALTER TABLE "RescueOrder" ADD COLUMN     "abandonedEmailAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "lastJobTitle" TEXT,
ADD COLUMN     "lastScore" INTEGER,
ADD COLUMN     "nurtureNextAt" TIMESTAMP(3),
ADD COLUMN     "nurtureStage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unsubscribedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'unsubscribe',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE INDEX "Lead_nurtureNextAt_idx" ON "Lead"("nurtureNextAt");

