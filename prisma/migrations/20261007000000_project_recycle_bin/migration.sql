ALTER TABLE `projects`
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `deletedById` VARCHAR(191) NULL;

CREATE INDEX `projects_userId_deletedAt_updatedAt_idx` ON `projects`(`userId`, `deletedAt`, `updatedAt`);
CREATE INDEX `projects_deletedAt_idx` ON `projects`(`deletedAt`);
