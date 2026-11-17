-- Existing tokens keep full access: backfill them as write, then make read the default for new tokens.
CREATE TYPE "ApiTokenScope" AS ENUM ('read', 'write');
ALTER TABLE "ApiToken" ADD COLUMN "scope" "ApiTokenScope" NOT NULL DEFAULT 'write';
ALTER TABLE "ApiToken" ALTER COLUMN "scope" SET DEFAULT 'read';
