-- AlterTable
ALTER TABLE "User" ADD COLUMN "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;

-- Set existing users as onboarded so they don't see the wizard
UPDATE "User" SET "onboardingCompleted" = true;
