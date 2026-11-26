ALTER TABLE "Membership" ADD COLUMN "inviteVerificationRequired" BOOLEAN NOT NULL DEFAULT false;

-- Gate only legacy memberships demonstrably created through an invitation.
UPDATE "Membership" AS m SET "inviteVerificationRequired" = true
FROM "User" AS u
WHERE m."userId" = u."id" AND u."emailVerifiedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "Invite" AS i
    WHERE i."usedById" = u."id" AND i."tenantId" = m."tenantId" AND i."usedAt" IS NOT NULL
  );
