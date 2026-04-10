-- CreateTable
CREATE TABLE "PricingPlan" (
    "id" TEXT NOT NULL,
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "priceAmount" INTEGER,
    "priceCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "priceInterval" TEXT,
    "priceLabel" JSONB,
    "unitLabel" JSONB,
    "features" JSONB NOT NULL DEFAULT '[]',
    "ctaLabel" JSONB NOT NULL,
    "ctaUrl" TEXT,
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "badgeLabel" JSONB,
    "customPricing" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingPlan_stripeProductId_key" ON "PricingPlan"("stripeProductId");

-- CreateIndex
CREATE INDEX "PricingPlan_sortOrder_idx" ON "PricingPlan"("sortOrder");
