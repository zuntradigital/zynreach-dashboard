-- AlterTable
ALTER TABLE `PricingVersion` ADD COLUMN `includedUsers` INTEGER NULL,
    ADD COLUMN `additionalUserPrice` DOUBLE NULL;
