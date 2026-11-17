-- CreateTable
CREATE TABLE `dy_apps` (
    `id` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(32) NOT NULL,
    `mpWorkId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `secretEnc` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `releaseIds` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dy_apps_appId_key`(`appId`),
    INDEX `dy_apps_mpWorkId_idx`(`mpWorkId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dy_users` (
    `id` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(32) NOT NULL,
    `openid` VARCHAR(96) NULL,
    `anonOpenid` VARCHAR(96) NULL,
    `unionid` VARCHAR(96) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    `firstSource` VARCHAR(24) NULL,
    `firstShareId` VARCHAR(16) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dy_users_appId_createdAt_idx`(`appId`, `createdAt`),
    INDEX `dy_users_unionid_idx`(`unionid`),
    UNIQUE INDEX `dy_users_appId_openid_key`(`appId`, `openid`),
    UNIQUE INDEX `dy_users_appId_anonOpenid_key`(`appId`, `anonOpenid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dy_saves` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(32) NOT NULL,
    `releaseId` VARCHAR(191) NOT NULL,
    `profile` JSON NOT NULL,
    `saves` JSON NOT NULL,
    `permanent` JSON NOT NULL,
    `rev` INTEGER NOT NULL DEFAULT 0,
    `progress` DOUBLE NOT NULL DEFAULT 0,
    `endingsGot` INTEGER NOT NULL DEFAULT 0,
    `lastPlayedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `dy_saves_userId_key`(`userId`),
    INDEX `dy_saves_appId_lastPlayedAt_idx`(`appId`, `lastPlayedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dy_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `appId` VARCHAR(32) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `anonId` VARCHAR(32) NOT NULL,
    `sessionId` VARCHAR(32) NOT NULL,
    `releaseId` VARCHAR(191) NULL,
    `nodeId` VARCHAR(64) NULL,
    `optionId` VARCHAR(64) NULL,
    `value` INTEGER NULL,
    `flag` BOOLEAN NULL,
    `source` VARCHAR(24) NULL,
    `shareId` VARCHAR(16) NULL,
    `clientTs` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dy_events_appId_name_createdAt_idx`(`appId`, `name`, `createdAt`),
    INDEX `dy_events_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dy_shares` (
    `id` VARCHAR(16) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `endingNodeId` VARCHAR(64) NULL,
    `newUsers` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dy_shares_appId_createdAt_idx`(`appId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
