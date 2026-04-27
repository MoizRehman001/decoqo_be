-- CreateEnum
CREATE TYPE "StorageUploadMode" AS ENUM ('VM_THEN_CLOUD', 'DIRECT_CLOUD', 'VM_ONLY');

-- CreateTable
CREATE TABLE "storage_settings" (
    "id" TEXT NOT NULL,
    "enableS3" BOOLEAN NOT NULL DEFAULT false,
    "enableR2" BOOLEAN NOT NULL DEFAULT true,
    "enableLocal" BOOLEAN NOT NULL DEFAULT false,
    "uploadMode" "StorageUploadMode" NOT NULL DEFAULT 'VM_THEN_CLOUD',
    "maxFileSizeBytes" BIGINT NOT NULL DEFAULT 10485760,
    "deleteAfterUpload" BOOLEAN NOT NULL DEFAULT true,
    "s3Config" JSONB,
    "r2Config" JSONB,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_upload_logs" (
    "id" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "uploadMode" TEXT NOT NULL,
    "s3Url" TEXT,
    "r2Url" TEXT,
    "localPath" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_upload_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storage_upload_logs_fileKey_idx" ON "storage_upload_logs"("fileKey");

-- CreateIndex
CREATE INDEX "storage_upload_logs_uploadedBy_idx" ON "storage_upload_logs"("uploadedBy");

-- CreateIndex
CREATE INDEX "storage_upload_logs_createdAt_idx" ON "storage_upload_logs"("createdAt");
