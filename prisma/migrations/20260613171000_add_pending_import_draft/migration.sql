ALTER TABLE `novel_promotion_projects`
  ADD COLUMN `pendingImportText` LONGTEXT NULL,
  ADD COLUMN `pendingImportEpisodeName` VARCHAR(191) NULL;
