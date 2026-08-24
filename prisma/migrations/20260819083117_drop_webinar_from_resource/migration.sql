-- AlterTable
ALTER TABLE `resource` MODIFY `resourceFormat` ENUM('GUIDE', 'TEMPLATE', 'WHITEPAPER') NOT NULL;

-- AlterTable
ALTER TABLE `resourceversion` DROP COLUMN `eventDate`;

