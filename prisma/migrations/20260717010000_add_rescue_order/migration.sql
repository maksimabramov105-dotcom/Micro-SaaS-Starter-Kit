-- CreateEnum
CREATE TYPE "RescueOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'GENERATING', 'DELIVERED', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "RescueOrder" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "status" "RescueOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "jobTitle" TEXT NOT NULL,
    "jobCompany" TEXT,
    "jobUrl" TEXT,
    "jobDescription" TEXT,
    "resumeText" TEXT NOT NULL,
    "stripeSessionId" TEXT,
    "paymentIntentId" TEXT,
    "resumeId" TEXT,
    "fitReport" JSONB,
    "upsellPromoId" TEXT,
    "upsellExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "paidAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RescueOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RescueOrder_stripeSessionId_key" ON "RescueOrder"("stripeSessionId");

-- CreateIndex
CREATE INDEX "RescueOrder_status_paidAt_idx" ON "RescueOrder"("status", "paidAt");

-- CreateIndex
CREATE INDEX "RescueOrder_email_idx" ON "RescueOrder"("email");

-- AddForeignKey
ALTER TABLE "RescueOrder" ADD CONSTRAINT "RescueOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

