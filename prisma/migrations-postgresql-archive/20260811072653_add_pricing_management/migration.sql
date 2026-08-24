-- CreateEnum
CREATE TYPE "PricingVisibility" AS ENUM ('PUBLIC', 'HIDDEN');

-- CreateTable
CREATE TABLE "PricingPlan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "visibility" "PricingVisibility" NOT NULL DEFAULT 'PUBLIC',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "submittedByUserId" TEXT,
    "reviewComment" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingVersion" (
    "id" TEXT NOT NULL,
    "pricingPlanId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "monthlyPrice" DOUBLE PRECISION,
    "annualPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "trialPeriodDays" INTEGER,
    "ctaTarget" TEXT NOT NULL DEFAULT 'trial',
    "effectiveDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "translations" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingFeature" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "translations" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingVersionFeature" (
    "pricingVersionId" TEXT NOT NULL,
    "pricingFeatureId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "PricingVersionFeature_pkey" PRIMARY KEY ("pricingVersionId","pricingFeatureId")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "translations" JSONB NOT NULL,
    "discountType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "discountValue" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionPlan" (
    "promotionId" TEXT NOT NULL,
    "pricingPlanId" TEXT NOT NULL,

    CONSTRAINT "PromotionPlan_pkey" PRIMARY KEY ("promotionId","pricingPlanId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingPlan_slug_key" ON "PricingPlan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PricingPlan_currentVersionId_key" ON "PricingPlan"("currentVersionId");

-- CreateIndex
CREATE INDEX "PricingPlan_status_idx" ON "PricingPlan"("status");

-- CreateIndex
CREATE INDEX "PricingVersion_pricingPlanId_idx" ON "PricingVersion"("pricingPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingVersion_pricingPlanId_versionNumber_key" ON "PricingVersion"("pricingPlanId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PricingFeature_key_key" ON "PricingFeature"("key");

-- CreateIndex
CREATE INDEX "PricingVersionFeature_pricingFeatureId_idx" ON "PricingVersionFeature"("pricingFeatureId");

-- CreateIndex
CREATE INDEX "PromotionPlan_pricingPlanId_idx" ON "PromotionPlan"("pricingPlanId");

-- AddForeignKey
ALTER TABLE "PricingPlan" ADD CONSTRAINT "PricingPlan_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "PricingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingPlan" ADD CONSTRAINT "PricingPlan_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingPlan" ADD CONSTRAINT "PricingPlan_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingVersion" ADD CONSTRAINT "PricingVersion_pricingPlanId_fkey" FOREIGN KEY ("pricingPlanId") REFERENCES "PricingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingVersion" ADD CONSTRAINT "PricingVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingVersion" ADD CONSTRAINT "PricingVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingVersionFeature" ADD CONSTRAINT "PricingVersionFeature_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingVersionFeature" ADD CONSTRAINT "PricingVersionFeature_pricingFeatureId_fkey" FOREIGN KEY ("pricingFeatureId") REFERENCES "PricingFeature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionPlan" ADD CONSTRAINT "PromotionPlan_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionPlan" ADD CONSTRAINT "PromotionPlan_pricingPlanId_fkey" FOREIGN KEY ("pricingPlanId") REFERENCES "PricingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
