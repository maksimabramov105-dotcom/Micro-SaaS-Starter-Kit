-- CreateTable: Lead — top-of-funnel email capture (e.g. /free-resume-teardown)
CREATE TABLE "Lead" (
    "id"        TEXT NOT NULL,
    "email"     TEXT NOT NULL,
    "source"    TEXT NOT NULL DEFAULT 'unknown',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");
