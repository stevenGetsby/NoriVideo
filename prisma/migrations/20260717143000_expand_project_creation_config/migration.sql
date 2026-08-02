ALTER TABLE `novel_promotion_projects`
  ADD COLUMN `episodeDurationMode` VARCHAR(191) NOT NULL DEFAULT 'per-episode',
  ADD COLUMN `episodeDurationValue` INTEGER NOT NULL DEFAULT 120,
  MODIFY COLUMN `projectLevel` VARCHAR(191) NOT NULL DEFAULT 'premium2',
  MODIFY COLUMN `videoResolution` VARCHAR(191) NOT NULL DEFAULT '480p',
  MODIFY COLUMN `targetEpisodeDurationSeconds` INTEGER NOT NULL DEFAULT 120;

UPDATE `novel_promotion_projects`
SET
  `episodeDurationMode` = 'per-episode',
  `episodeDurationValue` = `targetEpisodeDurationSeconds`;
