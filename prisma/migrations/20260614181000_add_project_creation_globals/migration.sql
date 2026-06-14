ALTER TABLE `novel_promotion_projects`
    ADD COLUMN `projectLevel` VARCHAR(191) NOT NULL DEFAULT 'Nori1.0',
    ADD COLUMN `projectStyle` VARCHAR(191) NOT NULL DEFAULT 'live-action',
    ADD COLUMN `targetAudience` VARCHAR(191) NOT NULL DEFAULT 'zh-platform',
    ADD COLUMN `targetEpisodeDurationSeconds` INTEGER NOT NULL DEFAULT 90;
