-- CreateTable: FeatureFlag, Experiment, ExperimentAssignment
-- Prompt 08: in-house feature flags + A/B experiment harness

CREATE TABLE "FeatureFlag" (
    "key"         TEXT         NOT NULL,
    "enabled"     BOOLEAN      NOT NULL DEFAULT false,
    "rolloutPct"  INTEGER      NOT NULL DEFAULT 0,
    "description" TEXT,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "Experiment" (
    "key"         TEXT         NOT NULL,
    "active"      BOOLEAN      NOT NULL DEFAULT true,
    "variants"    TEXT[],
    "weights"     INTEGER[],
    "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"     TIMESTAMP(3),
    "description" TEXT,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "ExperimentAssignment" (
    "id"            TEXT         NOT NULL,
    "experimentKey" TEXT         NOT NULL,
    "userId"        TEXT,
    "anonId"        TEXT,
    "variant"       TEXT         NOT NULL,
    "assignedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentAssignment_experimentKey_userId_key"
    ON "ExperimentAssignment"("experimentKey", "userId");

CREATE UNIQUE INDEX "ExperimentAssignment_experimentKey_anonId_key"
    ON "ExperimentAssignment"("experimentKey", "anonId");

CREATE INDEX "ExperimentAssignment_experimentKey_variant_idx"
    ON "ExperimentAssignment"("experimentKey", "variant");

CREATE INDEX "ExperimentAssignment_experimentKey_assignedAt_idx"
    ON "ExperimentAssignment"("experimentKey", "assignedAt");
