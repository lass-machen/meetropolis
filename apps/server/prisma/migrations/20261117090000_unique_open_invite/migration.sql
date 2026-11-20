-- The partial unique index below exists only in SQL because the Prisma
-- schema language cannot express a unique index with a WHERE clause.
-- It guarantees at most one open (unused) invite per tenant and email.

-- Keep the newest open invite per (tenantId, email) and delete older open
-- duplicates. EmailVerification rows of deleted invites are removed through
-- their ON DELETE CASCADE foreign key.
DELETE FROM "Invite" AS older
USING (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "email"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS position
  FROM "Invite"
  WHERE "usedAt" IS NULL AND "email" IS NOT NULL
) AS ranked
WHERE older."id" = ranked."id" AND ranked.position > 1;

CREATE UNIQUE INDEX "Invite_open_tenantId_email_key"
  ON "Invite" ("tenantId", "email")
  WHERE "usedAt" IS NULL AND "email" IS NOT NULL;
