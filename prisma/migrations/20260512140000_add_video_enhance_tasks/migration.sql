-- CreateTable: video_enhance_tasks
CREATE TABLE `video_enhance_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `fileSize` VARCHAR(191) NULL,
    `sourceUrl` TEXT NULL,
    `inputVideoUrl` TEXT NULL,
    `storageKey` TEXT NULL,
    `mediaKitTaskId` VARCHAR(191) NULL,
    `requestId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'submitted',
    `parameters` JSON NULL,
    `result` JSON NULL,
    `resultVideoUrl` TEXT NULL,
    `resultStorageKey` TEXT NULL,
    `errorMessage` TEXT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `video_enhance_tasks_mediaKitTaskId_key`(`mediaKitTaskId`),
    INDEX `video_enhance_tasks_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `video_enhance_tasks_userId_status_idx`(`userId`, `status`),
    INDEX `video_enhance_tasks_mediaKitTaskId_idx`(`mediaKitTaskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `video_enhance_tasks` ADD CONSTRAINT `video_enhance_tasks_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
