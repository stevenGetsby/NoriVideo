ALTER TABLE `frameos_materials`
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `deletedById` VARCHAR(191) NULL;

CREATE INDEX `frameos_materials_userId_deletedAt_createdAt_idx`
  ON `frameos_materials`(`userId`, `deletedAt`, `createdAt`);

CREATE INDEX `frameos_materials_projectId_deletedAt_createdAt_idx`
  ON `frameos_materials`(`projectId`, `deletedAt`, `createdAt`);
