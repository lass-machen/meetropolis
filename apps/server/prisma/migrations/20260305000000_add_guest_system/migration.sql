-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'guest';

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GuestToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestToken_token_key" ON "GuestToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "GuestToken_membershipId_key" ON "GuestToken"("membershipId");

-- AddForeignKey
ALTER TABLE "GuestToken" ADD CONSTRAINT "GuestToken_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
