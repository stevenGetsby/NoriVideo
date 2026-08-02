CREATE TABLE `service_usage_records` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(128) NOT NULL,
    `modelKey` VARCHAR(255) NULL,
    `serviceType` VARCHAR(32) NOT NULL,
    `operation` VARCHAR(128) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'success',
    `userId` VARCHAR(191) NULL,
    `projectId` VARCHAR(191) NULL,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `units` DECIMAL(18, 4) NOT NULL DEFAULT 1,
    `latencyMs` INTEGER NULL,
    `errorCode` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `service_usage_records_provider_createdAt_idx`(`provider`, `createdAt`),
    INDEX `service_usage_records_modelKey_createdAt_idx`(`modelKey`, `createdAt`),
    INDEX `service_usage_records_serviceType_createdAt_idx`(`serviceType`, `createdAt`),
    INDEX `service_usage_records_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `service_health_checks` (
    `id` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(32) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `latencyMs` INTEGER NULL,
    `message` TEXT NULL,
    `details` JSON NULL,
    `checkedBy` VARCHAR(191) NULL,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `service_health_checks_targetType_targetId_checkedAt_idx`(`targetType`, `targetId`, `checkedAt`),
    INDEX `service_health_checks_status_checkedAt_idx`(`status`, `checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
