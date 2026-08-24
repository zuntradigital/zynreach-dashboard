-- CreateTable
CREATE TABLE "JobListing" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "submittedByUserId" TEXT,
    "reviewComment" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobListingVersion" (
    "id" TEXT NOT NULL,
    "jobListingId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "datePosted" TIMESTAMP(3),
    "translations" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobListingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobListing_slug_key" ON "JobListing"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "JobListing_currentVersionId_key" ON "JobListing"("currentVersionId");

-- CreateIndex
CREATE INDEX "JobListing_status_idx" ON "JobListing"("status");

-- CreateIndex
CREATE INDEX "JobListingVersion_jobListingId_idx" ON "JobListingVersion"("jobListingId");

-- CreateIndex
CREATE UNIQUE INDEX "JobListingVersion_jobListingId_versionNumber_key" ON "JobListingVersion"("jobListingId", "versionNumber");

-- AddForeignKey
ALTER TABLE "JobListing" ADD CONSTRAINT "JobListing_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "JobListingVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobListing" ADD CONSTRAINT "JobListing_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobListing" ADD CONSTRAINT "JobListing_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobListingVersion" ADD CONSTRAINT "JobListingVersion_jobListingId_fkey" FOREIGN KEY ("jobListingId") REFERENCES "JobListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobListingVersion" ADD CONSTRAINT "JobListingVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobListingVersion" ADD CONSTRAINT "JobListingVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
