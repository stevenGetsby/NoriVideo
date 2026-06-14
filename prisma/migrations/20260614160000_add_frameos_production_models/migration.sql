-- CreateTable
CREATE TABLE `frameos_materials` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `ownerName` VARCHAR(191) NULL,
    `title` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ready',
    `isFavorited` BOOLEAN NOT NULL DEFAULT false,
    `resultUrl` TEXT NULL,
    `storageKey` TEXT NULL,
    `isSuperresolved` BOOLEAN NOT NULL DEFAULT false,
    `isSubtitleErased` BOOLEAN NOT NULL DEFAULT false,
    `bindingStatus` VARCHAR(191) NOT NULL DEFAULT 'unbound',
    `isSelected` BOOLEAN NOT NULL DEFAULT false,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `frameos_materials_projectId_createdAt_idx`(`projectId`, `createdAt`),
    INDEX `frameos_materials_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `frameos_materials_projectId_type_idx`(`projectId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `frameos_scripts` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `bibleContent` JSON NULL,
    `bibleLocked` BOOLEAN NOT NULL DEFAULT false,
    `targetBibleContent` JSON NULL,
    `targetBibleLocked` BOOLEAN NOT NULL DEFAULT false,
    `marketRules` JSON NULL,
    `sections` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `frameos_scripts_userId_status_idx`(`userId`, `status`),
    INDEX `frameos_scripts_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `frameos_worlds` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `worldLabel` VARCHAR(191) NOT NULL,
    `worldBackground` TEXT NULL,
    `representativeFrame` VARCHAR(191) NULL,
    `candidates` JSON NULL,
    `selectedStyleAnchor` VARCHAR(191) NULL,
    `previewMaterials` JSON NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `frameos_worlds_projectId_idx`(`projectId`),
    UNIQUE INDEX `frameos_worlds_projectId_worldLabel_key`(`projectId`, `worldLabel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `frameos_art_directions` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `flowStatus` VARCHAR(191) NOT NULL DEFAULT 'idle',
    `flowId` VARCHAR(191) NULL,
    `currentLabel` VARCHAR(191) NULL,
    `derivedPhase` VARCHAR(191) NULL,
    `defaultWorldLabel` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `frameos_art_directions_projectId_key`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `frameos_screenwriter_episodes` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `scriptId` VARCHAR(191) NULL,
    `episodeNumber` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `contentKilo` DOUBLE NOT NULL DEFAULT 0,
    `infoPoints` TEXT NULL,
    `sourceAnchor` JSON NULL,
    `reasoning` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `scenes` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `frameos_screenwriter_episodes_projectId_idx`(`projectId`),
    INDEX `frameos_screenwriter_episodes_scriptId_idx`(`scriptId`),
    UNIQUE INDEX `frameos_screenwriter_episodes_projectId_episodeNumber_key`(`projectId`, `episodeNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `frameos_director_episodes` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `episodeId` VARCHAR(191) NOT NULL,
    `directorConfirmed` BOOLEAN NOT NULL DEFAULT false,
    `shotStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `steps` JSON NULL,
    `emotionArc` TEXT NULL,
    `reasoning` JSON NULL,
    `bgmPlans` JSON NULL,
    `totalSceneCount` INTEGER NOT NULL DEFAULT 0,
    `totalShotCount` INTEGER NOT NULL DEFAULT 0,
    `totalDurationSeconds` DOUBLE NOT NULL DEFAULT 0,
    `scenes` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `frameos_director_episodes_projectId_idx`(`projectId`),
    UNIQUE INDEX `frameos_director_episodes_projectId_episodeId_key`(`projectId`, `episodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `frameos_production_scenes` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `episodeId` VARCHAR(191) NOT NULL,
    `sceneNo` INTEGER NOT NULL,
    `sceneTitle` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `frameos_production_scenes_projectId_idx`(`projectId`),
    INDEX `frameos_production_scenes_episodeId_idx`(`episodeId`),
    UNIQUE INDEX `frameos_production_scenes_projectId_episodeId_sceneNo_key`(`projectId`, `episodeId`, `sceneNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `frameos_production_shots` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `episodeId` VARCHAR(191) NOT NULL,
    `sceneId` VARCHAR(191) NOT NULL,
    `shotNo` VARCHAR(191) NOT NULL,
    `shotTitle` VARCHAR(191) NULL,
    `shotStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `durationSeconds` DOUBLE NOT NULL DEFAULT 0,
    `needsRevision` BOOLEAN NOT NULL DEFAULT false,
    `videoPrompt` TEXT NULL,
    `stylePrompt` TEXT NULL,
    `aspectRatio` VARCHAR(191) NULL,
    `resolution` VARCHAR(191) NULL,
    `currentMaterialId` VARCHAR(191) NULL,
    `currentMaterialUrl` TEXT NULL,
    `videoStatus` VARCHAR(191) NOT NULL DEFAULT 'idle',
    `errorMessage` TEXT NULL,
    `characters` JSON NULL,
    `environments` JSON NULL,
    `items` JSON NULL,
    `useReferenceVideo` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `frameos_production_shots_projectId_episodeId_idx`(`projectId`, `episodeId`),
    INDEX `frameos_production_shots_sceneId_idx`(`sceneId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `frameos_production_bgm_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `sceneId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'idle',
    `url` TEXT NULL,
    `errorMessage` TEXT NULL,
    `caption` TEXT NULL,
    `lyrics` TEXT NULL,
    `durationEstimate` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `frameos_production_bgm_tasks_projectId_idx`(`projectId`),
    UNIQUE INDEX `frameos_production_bgm_tasks_projectId_sceneId_key`(`projectId`, `sceneId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `frameos_toolbox_assets` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'toolbox',
    `bizType` VARCHAR(191) NULL,
    `modelId` VARCHAR(191) NULL,
    `skuCode` VARCHAR(191) NULL,
    `materialId` VARCHAR(191) NULL,
    `params` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `resultUrl` TEXT NULL,
    `isFavorited` BOOLEAN NOT NULL DEFAULT false,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `frameos_toolbox_assets_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `frameos_toolbox_assets_projectId_createdAt_idx`(`projectId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `frameos_toolbox_prompt_history` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NULL,
    `sessionId` VARCHAR(191) NULL,
    `variant` VARCHAR(191) NOT NULL DEFAULT 'default',
    `messages` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `frameos_toolbox_prompt_history_userId_assetId_idx`(`userId`, `assetId`),
    INDEX `frameos_toolbox_prompt_history_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

