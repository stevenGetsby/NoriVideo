-- CreateTable: canvases
CREATE TABLE `canvases` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `themeColor` VARCHAR(191) NULL,
    `viewport` JSON NULL,
    `visibility` VARCHAR(191) NOT NULL DEFAULT 'PRIVATE',
    `forkedFromId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `canvases_projectId_idx`(`projectId`),
    INDEX `canvases_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: canvas_nodes
CREATE TABLE `canvas_nodes` (
    `id` VARCHAR(191) NOT NULL,
    `canvasId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `position` JSON NOT NULL,
    `size` JSON NULL,
    `data` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'IDLE',
    `taskId` VARCHAR(191) NULL,
    `runId` VARCHAR(191) NULL,
    `mediaObjectId` VARCHAR(191) NULL,
    `parentNodeId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `canvas_nodes_canvasId_idx`(`canvasId`),
    INDEX `canvas_nodes_parentNodeId_idx`(`parentNodeId`),
    INDEX `canvas_nodes_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: canvas_edges
CREATE TABLE `canvas_edges` (
    `id` VARCHAR(191) NOT NULL,
    `canvasId` VARCHAR(191) NOT NULL,
    `sourceNodeId` VARCHAR(191) NOT NULL,
    `targetNodeId` VARCHAR(191) NOT NULL,
    `sourceHandle` VARCHAR(191) NULL,
    `targetHandle` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'INPUT_DEFAULT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    -- MySQL utf8mb4 索引长度上限 3072 字节；handle 列在应用层做去重，不进入索引
    INDEX `canvas_edges_canvasId_sourceNodeId_targetNodeId_idx`(
        `canvasId`, `sourceNodeId`, `targetNodeId`
    ),
    INDEX `canvas_edges_canvasId_idx`(`canvasId`),
    INDEX `canvas_edges_sourceNodeId_idx`(`sourceNodeId`),
    INDEX `canvas_edges_targetNodeId_idx`(`targetNodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `canvases` ADD CONSTRAINT `canvases_projectId_fkey`
    FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `canvas_nodes` ADD CONSTRAINT `canvas_nodes_canvasId_fkey`
    FOREIGN KEY (`canvasId`) REFERENCES `canvases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `canvas_edges` ADD CONSTRAINT `canvas_edges_canvasId_fkey`
    FOREIGN KEY (`canvasId`) REFERENCES `canvases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
