-- CreateTable: StripeEvent
-- Stores processed Stripe event IDs to prevent double-processing on retries.
-- RED-1 audit fix.
CREATE TABLE "StripeEvent" (
    "id"          TEXT         NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StripeEvent_processedAt_idx" ON "StripeEvent"("processedAt");
