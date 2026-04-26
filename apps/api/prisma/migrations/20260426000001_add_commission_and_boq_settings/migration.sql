-- CreateEnum
CREATE TYPE "CommissionPolicyType" AS ENUM ('PROJECT_COUNT', 'TIME_RANGE', 'AMOUNT_RANGE', 'CUSTOM_OVERRIDE');

-- CreateTable: commission_policies
CREATE TABLE "commission_policies" (
    "id"                     TEXT NOT NULL,
    "name"                   TEXT NOT NULL,
    "description"            TEXT,
    "type"                   "CommissionPolicyType" NOT NULL,
    "priority"               INTEGER NOT NULL DEFAULT 0,
    "isActive"               BOOLEAN NOT NULL DEFAULT true,
    "conditions"             JSONB NOT NULL,
    "actions"                JSONB NOT NULL,
    "applicableDesignerIds"  JSONB NOT NULL DEFAULT '[]',
    "applicableCities"       JSONB NOT NULL DEFAULT '[]',
    "applicableStates"       JSONB NOT NULL DEFAULT '[]',
    "createdBy"              TEXT NOT NULL,
    "updatedBy"              TEXT,
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_policies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commission_policies_isActive_priority_idx" ON "commission_policies"("isActive", "priority");
CREATE INDEX "commission_policies_type_isActive_idx" ON "commission_policies"("type", "isActive");

-- CreateTable: designer_stats
CREATE TABLE "designer_stats" (
    "id"            TEXT NOT NULL,
    "designerId"    TEXT NOT NULL,
    "totalProjects" INTEGER NOT NULL DEFAULT 0,
    "totalGmvPaise" BIGINT NOT NULL DEFAULT 0,
    "rating"        DOUBLE PRECISION,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "designer_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "designer_stats_designerId_key" ON "designer_stats"("designerId");

ALTER TABLE "designer_stats"
    ADD CONSTRAINT "designer_stats_designerId_fkey"
    FOREIGN KEY ("designerId") REFERENCES "vendor_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: boq_pdf_settings
CREATE TABLE "boq_pdf_settings" (
    "id"               TEXT NOT NULL,
    "watermarkText"    TEXT NOT NULL DEFAULT 'DECOQO CONFIDENTIAL',
    "watermarkOpacity" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    "watermarkAngle"   INTEGER NOT NULL DEFAULT -45,
    "showClientName"   BOOLEAN NOT NULL DEFAULT true,
    "showTimestamp"    BOOLEAN NOT NULL DEFAULT true,
    "isActive"         BOOLEAN NOT NULL DEFAULT true,
    "updatedBy"        TEXT,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boq_pdf_settings_pkey" PRIMARY KEY ("id")
);

-- Seed default BOQ PDF settings row
INSERT INTO "boq_pdf_settings" ("id", "watermarkText", "watermarkOpacity", "watermarkAngle", "showClientName", "showTimestamp", "isActive", "updatedAt")
VALUES (gen_random_uuid()::text, 'DECOQO CONFIDENTIAL', 0.08, -45, true, true, true, NOW());
