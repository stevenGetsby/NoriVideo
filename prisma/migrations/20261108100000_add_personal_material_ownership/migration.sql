ALTER TABLE `frameos_materials`
  ADD COLUMN `personalOwnerId` VARCHAR(191) NULL;

CREATE INDEX `frameos_materials_personalOwnerId_deletedAt_createdAt_idx`
  ON `frameos_materials`(`personalOwnerId`, `deletedAt`, `createdAt`);
