ALTER TABLE "EmailVerification"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'verify',
  ADD COLUMN "sourceEmail" TEXT,
  ADD COLUMN "inviteId" TEXT,
  ADD COLUMN "readyAt" TIMESTAMP(3);

-- Do not reinterpret legacy raw values as new proof of mailbox ownership.
UPDATE "EmailVerification" SET "expiresAt" = LEAST("expiresAt", CURRENT_TIMESTAMP)
WHERE "usedAt" IS NULL;

ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_inviteId_fkey"
  FOREIGN KEY ("inviteId") REFERENCES "Invite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
