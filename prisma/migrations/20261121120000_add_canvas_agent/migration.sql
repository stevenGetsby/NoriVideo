CREATE TABLE `canvas_agent_threads` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `canvasId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(80) NOT NULL,
    `messages` JSON NOT NULL,
    `messageCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `canvas_agent_threads_canvasId_userId_updatedAt_idx`(`canvasId`, `userId`, `updatedAt`),
    INDEX `canvas_agent_threads_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `canvas_agent_threads` ADD CONSTRAINT `canvas_agent_threads_canvasId_fkey` FOREIGN KEY (`canvasId`) REFERENCES `canvases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
