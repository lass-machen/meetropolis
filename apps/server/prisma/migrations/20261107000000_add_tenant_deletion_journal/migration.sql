-- CreateEnum
CREATE TYPE "DeletionJournalStatus" AS ENUM ('blocked', 'requested', 'db_deleted', 'cleanup_pending', 'completed');

-- CreateEnum
CREATE TYPE "DeletionTaskStatus" AS ENUM ('pending', 'leased', 'retry', 'manual_required', 'done', 'failed');

-- CreateTable
CREATE TABLE "DeletionJournal" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "generation" BIGSERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "tenantRef" TEXT,
    "accountRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objectRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "policyVersion" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dbDeletedAt" TIMESTAMP(3),
    "accessStatus" VARCHAR(64) NOT NULL DEFAULT 'pending',
    "cleanupStatus" VARCHAR(64) NOT NULL DEFAULT 'pending',
    "status" "DeletionJournalStatus" NOT NULL DEFAULT 'requested',
    "completedAt" TIMESTAMP(3),
    "journalUntil" TIMESTAMP(3) NOT NULL,
    "lastErrorCode" VARCHAR(64),

    CONSTRAINT "DeletionJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionTask" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "targetSystem" VARCHAR(64) NOT NULL,
    "objectId" TEXT NOT NULL,
    "objectGeneration" TEXT NOT NULL,
    "storageKey" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "status" "DeletionTaskStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(64),
    "completedAt" TIMESTAMP(3),
    "receiptCode" VARCHAR(64),

    CONSTRAINT "DeletionTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeletionJournal_idempotencyKey_key" ON "DeletionJournal"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "DeletionJournal_generation_key" ON "DeletionJournal"("generation");

-- CreateIndex
CREATE INDEX "DeletionJournal_status_journalUntil_idx" ON "DeletionJournal"("status", "journalUntil");

-- CreateIndex
CREATE UNIQUE INDEX "DeletionTask_dedupeKey_key" ON "DeletionTask"("dedupeKey");

-- CreateIndex
CREATE INDEX "DeletionTask_journalId_idx" ON "DeletionTask"("journalId");

-- CreateIndex
CREATE INDEX "DeletionTask_status_nextAttemptAt_idx" ON "DeletionTask"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "DeletionTask" ADD CONSTRAINT "DeletionTask_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "DeletionJournal"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

