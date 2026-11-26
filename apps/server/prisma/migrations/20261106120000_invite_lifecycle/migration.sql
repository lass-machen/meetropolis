ALTER TABLE "Invite" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "Invite" ADD COLUMN "lastSentAt" TIMESTAMP(3);
ALTER TABLE "Invite" ADD COLUMN "sendCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invite" ADD COLUMN "lastSendError" TEXT;
-- Backfill: open invites get the regular 7-day lifetime from now on; accepted ones stay NULL.
UPDATE "Invite" SET "expiresAt" = now() + interval '7 days' WHERE "usedAt" IS NULL;
