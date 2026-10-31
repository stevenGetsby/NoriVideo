ALTER TABLE `works`
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `deletedById` VARCHAR(191) NULL;

CREATE INDEX `works_deletedAt_idx` ON `works`(`deletedAt`);

ALTER TABLE `projects`
  ADD COLUMN `deletedWithWork` BOOLEAN NOT NULL DEFAULT FALSE;
