-- CreateTable
CREATE TABLE "AnnouncementBanner" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "dismissible" BOOLEAN NOT NULL DEFAULT true,
    "targetZone" TEXT NOT NULL DEFAULT 'sitewide',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnouncementBanner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnnouncementBanner_startDate_endDate_idx" ON "AnnouncementBanner"("startDate", "endDate");

-- AddForeignKey
ALTER TABLE "AnnouncementBanner" ADD CONSTRAINT "AnnouncementBanner_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
