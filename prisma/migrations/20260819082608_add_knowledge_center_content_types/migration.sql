-- AlterTable
ALTER TABLE `resource` ADD COLUMN `downloadFileId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `CustomerStory` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerLogoId` VARCHAR(191) NULL,
    `industry` VARCHAR(191) NOT NULL,
    `companySize` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `currentVersionId` VARCHAR(191) NULL,
    `submittedByUserId` VARCHAR(191) NULL,
    `reviewComment` TEXT NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerStory_slug_key`(`slug`),
    UNIQUE INDEX `CustomerStory_currentVersionId_key`(`currentVersionId`),
    INDEX `CustomerStory_status_idx`(`status`),
    INDEX `CustomerStory_industry_idx`(`industry`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerStoryVersion` (
    `id` VARCHAR(191) NOT NULL,
    `customerStoryId` VARCHAR(191) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `testimonialName` VARCHAR(191) NULL,
    `testimonialTitle` VARCHAR(191) NULL,
    `testimonialCompany` VARCHAR(191) NULL,
    `testimonialPhotoId` VARCHAR(191) NULL,
    `relatedCapabilitySlugs` JSON NOT NULL,
    `translations` JSON NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `publishedByUserId` VARCHAR(191) NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CustomerStoryVersion_customerStoryId_idx`(`customerStoryId`),
    UNIQUE INDEX `CustomerStoryVersion_customerStoryId_versionNumber_key`(`customerStoryId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Webinar` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `gated` BOOLEAN NOT NULL DEFAULT true,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `currentVersionId` VARCHAR(191) NULL,
    `submittedByUserId` VARCHAR(191) NULL,
    `reviewComment` TEXT NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Webinar_slug_key`(`slug`),
    UNIQUE INDEX `Webinar_currentVersionId_key`(`currentVersionId`),
    INDEX `Webinar_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebinarVersion` (
    `id` VARCHAR(191) NOT NULL,
    `webinarId` VARCHAR(191) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `scheduledAt` DATETIME(3) NULL,
    `durationMinutes` INTEGER NULL,
    `isOnDemand` BOOLEAN NOT NULL DEFAULT false,
    `videoUrl` TEXT NULL,
    `speakerPhotoId` VARCHAR(191) NULL,
    `translations` JSON NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `publishedByUserId` VARCHAR(191) NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WebinarVersion_webinarId_idx`(`webinarId`),
    UNIQUE INDEX `WebinarVersion_webinarId_versionNumber_key`(`webinarId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocCategory` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `translations` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DocCategory_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocArticle` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `parentArticleId` VARCHAR(191) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `version` VARCHAR(191) NOT NULL DEFAULT '1.0',
    `status` ENUM('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `relatedArticleSlugs` JSON NOT NULL,
    `translations` JSON NOT NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DocArticle_slug_key`(`slug`),
    INDEX `DocArticle_status_idx`(`status`),
    INDEX `DocArticle_categoryId_idx`(`categoryId`),
    INDEX `DocArticle_parentArticleId_idx`(`parentArticleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiResourceGroup` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `translations` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ApiResourceGroup_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiEndpoint` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `resourceGroupId` VARCHAR(191) NULL,
    `method` ENUM('GET', 'POST', 'PUT', 'PATCH', 'DELETE') NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `authRequired` BOOLEAN NOT NULL DEFAULT true,
    `version` VARCHAR(191) NOT NULL DEFAULT 'v1',
    `order` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `translations` JSON NOT NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ApiEndpoint_slug_key`(`slug`),
    INDEX `ApiEndpoint_status_idx`(`status`),
    INDEX `ApiEndpoint_resourceGroupId_idx`(`resourceGroupId`),
    INDEX `ApiEndpoint_method_idx`(`method`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Resource` ADD CONSTRAINT `Resource_downloadFileId_fkey` FOREIGN KEY (`downloadFileId`) REFERENCES `MediaAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStory` ADD CONSTRAINT `CustomerStory_customerLogoId_fkey` FOREIGN KEY (`customerLogoId`) REFERENCES `MediaAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStory` ADD CONSTRAINT `CustomerStory_currentVersionId_fkey` FOREIGN KEY (`currentVersionId`) REFERENCES `CustomerStoryVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStory` ADD CONSTRAINT `CustomerStory_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStory` ADD CONSTRAINT `CustomerStory_submittedByUserId_fkey` FOREIGN KEY (`submittedByUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStoryVersion` ADD CONSTRAINT `CustomerStoryVersion_customerStoryId_fkey` FOREIGN KEY (`customerStoryId`) REFERENCES `CustomerStory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStoryVersion` ADD CONSTRAINT `CustomerStoryVersion_testimonialPhotoId_fkey` FOREIGN KEY (`testimonialPhotoId`) REFERENCES `MediaAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStoryVersion` ADD CONSTRAINT `CustomerStoryVersion_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStoryVersion` ADD CONSTRAINT `CustomerStoryVersion_publishedByUserId_fkey` FOREIGN KEY (`publishedByUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Webinar` ADD CONSTRAINT `Webinar_currentVersionId_fkey` FOREIGN KEY (`currentVersionId`) REFERENCES `WebinarVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Webinar` ADD CONSTRAINT `Webinar_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Webinar` ADD CONSTRAINT `Webinar_submittedByUserId_fkey` FOREIGN KEY (`submittedByUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebinarVersion` ADD CONSTRAINT `WebinarVersion_webinarId_fkey` FOREIGN KEY (`webinarId`) REFERENCES `Webinar`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebinarVersion` ADD CONSTRAINT `WebinarVersion_speakerPhotoId_fkey` FOREIGN KEY (`speakerPhotoId`) REFERENCES `MediaAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebinarVersion` ADD CONSTRAINT `WebinarVersion_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebinarVersion` ADD CONSTRAINT `WebinarVersion_publishedByUserId_fkey` FOREIGN KEY (`publishedByUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocArticle` ADD CONSTRAINT `DocArticle_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `DocCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocArticle` ADD CONSTRAINT `DocArticle_parentArticleId_fkey` FOREIGN KEY (`parentArticleId`) REFERENCES `DocArticle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocArticle` ADD CONSTRAINT `DocArticle_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiEndpoint` ADD CONSTRAINT `ApiEndpoint_resourceGroupId_fkey` FOREIGN KEY (`resourceGroupId`) REFERENCES `ApiResourceGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiEndpoint` ADD CONSTRAINT `ApiEndpoint_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
