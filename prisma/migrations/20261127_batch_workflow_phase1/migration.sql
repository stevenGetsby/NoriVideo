-- 5-Stage Skill-Pluggable Video Workflow
-- Additive & idempotent MySQL 8.0 DDL matching prisma/schema.prisma 1:1.

CREATE TABLE IF NOT EXISTS `workflow_skills` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `slug` VARCHAR(128) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `track` VARCHAR(64) NOT NULL,
    `stage` VARCHAR(32) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `parentSkillId` VARCHAR(191) NULL,
    `changeNote` TEXT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `description` TEXT NULL,
    `systemPrompt` LONGTEXT NOT NULL,
    `fewShotExamples` JSON NULL,
    `outputSchema` JSON NULL,
    `modelPreferences` JSON NULL,
    `qcRules` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_skills_userId_track_stage_idx`(`userId`, `track`, `stage`),
    INDEX `workflow_skills_slug_version_idx`(`slug`, `version`),
    INDEX `workflow_skills_track_stage_isDefault_idx`(`track`, `stage`, `isDefault`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Idempotent additive column guard for environments where workflow_skills already existed
SET @has_parent_skill_id := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'workflow_skills'
      AND COLUMN_NAME = 'parentSkillId'
);
SET @sql_add_parent_skill_id := IF(
    @has_parent_skill_id = 0,
    'ALTER TABLE `workflow_skills` ADD COLUMN `parentSkillId` VARCHAR(191) NULL AFTER `version`',
    'SELECT 1'
);
PREPARE stmt_add_parent_skill_id FROM @sql_add_parent_skill_id;
EXECUTE stmt_add_parent_skill_id;
DEALLOCATE PREPARE stmt_add_parent_skill_id;

SET @has_change_note := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'workflow_skills'
      AND COLUMN_NAME = 'changeNote'
);
SET @sql_add_change_note := IF(
    @has_change_note = 0,
    'ALTER TABLE `workflow_skills` ADD COLUMN `changeNote` TEXT NULL AFTER `parentSkillId`',
    'SELECT 1'
);
PREPARE stmt_add_change_note FROM @sql_add_change_note;
EXECUTE stmt_add_change_note;
DEALLOCATE PREPARE stmt_add_change_note;

CREATE TABLE IF NOT EXISTS `workflow_templates` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `slug` VARCHAR(128) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `track` VARCHAR(64) NOT NULL,
    `description` TEXT NULL,
    `stages` JSON NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_templates_userId_track_idx`(`userId`, `track`),
    INDEX `workflow_templates_slug_idx`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `batch_runs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `workId` VARCHAR(191) NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `templateSnapshot` JSON NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `track` VARCHAR(64) NOT NULL,
    `runMode` VARCHAR(24) NOT NULL DEFAULT 'gated',
    `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `totalItems` INTEGER NOT NULL DEFAULT 0,
    `completedItems` INTEGER NOT NULL DEFAULT 0,
    `failedItems` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `batch_runs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `batch_runs_projectId_createdAt_idx`(`projectId`, `createdAt`),
    INDEX `batch_runs_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `batch_items` (
    `id` VARCHAR(191) NOT NULL,
    `batchRunId` VARCHAR(191) NOT NULL,
    `index` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `inputPayload` JSON NOT NULL,
    `currentStage` VARCHAR(32) NOT NULL DEFAULT 'script_analysis',
    `status` VARCHAR(24) NOT NULL DEFAULT 'queued',
    `stageStates` JSON NOT NULL,
    `stageOutputs` JSON NOT NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `batch_items_batchRunId_index_idx`(`batchRunId`, `index`),
    INDEX `batch_items_batchRunId_status_idx`(`batchRunId`, `status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `batch_items_batchRunId_fkey` FOREIGN KEY (`batchRunId`) REFERENCES `batch_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
