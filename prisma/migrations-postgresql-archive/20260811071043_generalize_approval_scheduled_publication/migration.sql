-- Generalize Approval and ScheduledPublication from Page-specific pageId
-- to resourceType/resourceId, ahead of Pricing becoming the second
-- governed content type. Same shape AuditLog already uses for its own
-- resourceType/resourceId pair (unenforced by a DB FK, since a real FK
-- can't span multiple target tables).

-- Approval --------------------------------------------------------------
ALTER TABLE "Approval" DROP CONSTRAINT "Approval_pageId_fkey";
DROP INDEX "Approval_pageId_idx";

ALTER TABLE "Approval" ADD COLUMN "resourceType" TEXT;
ALTER TABLE "Approval" ADD COLUMN "resourceId" TEXT;

UPDATE "Approval" SET "resourceType" = 'Page', "resourceId" = "pageId" WHERE "pageId" IS NOT NULL;

ALTER TABLE "Approval" ALTER COLUMN "resourceType" SET NOT NULL;
ALTER TABLE "Approval" ALTER COLUMN "resourceId" SET NOT NULL;
ALTER TABLE "Approval" DROP COLUMN "pageId";

CREATE INDEX "Approval_resourceType_resourceId_idx" ON "Approval"("resourceType", "resourceId");

-- ScheduledPublication ----------------------------------------------------
ALTER TABLE "ScheduledPublication" DROP CONSTRAINT "ScheduledPublication_pageId_fkey";
DROP INDEX "ScheduledPublication_pageId_idx";

ALTER TABLE "ScheduledPublication" ADD COLUMN "resourceType" TEXT;
ALTER TABLE "ScheduledPublication" ADD COLUMN "resourceId" TEXT;

UPDATE "ScheduledPublication" SET "resourceType" = 'Page', "resourceId" = "pageId" WHERE "pageId" IS NOT NULL;

ALTER TABLE "ScheduledPublication" ALTER COLUMN "resourceType" SET NOT NULL;
ALTER TABLE "ScheduledPublication" ALTER COLUMN "resourceId" SET NOT NULL;
ALTER TABLE "ScheduledPublication" DROP COLUMN "pageId";

CREATE INDEX "ScheduledPublication_resourceType_resourceId_idx" ON "ScheduledPublication"("resourceType", "resourceId");
