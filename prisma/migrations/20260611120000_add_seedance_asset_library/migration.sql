ALTER TABLE `character_appearances`
  ADD COLUMN `seedanceAssetId` VARCHAR(191) NULL,
  ADD COLUMN `seedanceAssetUri` TEXT NULL,
  ADD COLUMN `seedanceAssetStatus` VARCHAR(191) NULL,
  ADD COLUMN `seedanceAssetError` TEXT NULL,
  ADD COLUMN `seedanceAssetImageUrl` TEXT NULL,
  ADD COLUMN `seedanceAssetSyncedAt` DATETIME(3) NULL;

ALTER TABLE `novel_promotion_characters`
  ADD COLUMN `seedanceAssetGroupId` VARCHAR(191) NULL,
  ADD COLUMN `seedanceAssetsProjectName` VARCHAR(191) NULL;

ALTER TABLE `user_preferences`
  ADD COLUMN `arkAssetsAccessKeyId` TEXT NULL,
  ADD COLUMN `arkAssetsSecretAccessKey` TEXT NULL,
  ADD COLUMN `arkAssetsProjectName` VARCHAR(191) NULL DEFAULT 'default';
