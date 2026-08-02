-- Upgrade the M0 canvas graph into a revisioned document.
ALTER TABLE `canvases`
    ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `canvas_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `canvasId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `changeSummary` VARCHAR(191) NULL,
    `document` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `canvas_snapshots_canvasId_revision_key`(`canvasId`, `revision`),
    INDEX `canvas_snapshots_canvasId_createdAt_idx`(`canvasId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `canvas_snapshots`
    ADD CONSTRAINT `canvas_snapshots_canvasId_fkey`
    FOREIGN KEY (`canvasId`) REFERENCES `canvases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
