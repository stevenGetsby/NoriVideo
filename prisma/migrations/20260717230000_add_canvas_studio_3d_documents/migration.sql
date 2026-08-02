-- Store each 3D director studio scene as its own revisioned document. This
-- keeps high-frequency scene edits independent from the canvas graph document.
CREATE TABLE `canvas_studio_3d_documents` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `canvasId` VARCHAR(191) NOT NULL,
    `nodeId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `document` JSON NOT NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `canvas_studio_3d_documents_nodeId_key`(`nodeId`),
    INDEX `canvas_studio_3d_documents_projectId_canvasId_idx`(`projectId`, `canvasId`),
    INDEX `canvas_studio_3d_documents_canvasId_nodeId_idx`(`canvasId`, `nodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `canvas_studio_3d_documents`
    ADD CONSTRAINT `canvas_studio_3d_documents_nodeId_fkey`
    FOREIGN KEY (`nodeId`) REFERENCES `canvas_nodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the legacy node.data.studioScene payload. Lazily-created documents
-- use the same seed path in the API, so nodes created during a rolling deploy
-- are covered as well.
INSERT INTO `canvas_studio_3d_documents`
    (`id`, `projectId`, `canvasId`, `nodeId`, `revision`, `document`, `createdAt`, `updatedAt`)
SELECT
    UUID(),
    c.`projectId`,
    n.`canvasId`,
    n.`id`,
    0,
    JSON_EXTRACT(n.`data`, '$.studioScene'),
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `canvas_nodes` n
INNER JOIN `canvases` c ON c.`id` = n.`canvasId`
WHERE n.`type` = 'studio_3d'
  AND n.`data` IS NOT NULL
  AND JSON_TYPE(JSON_EXTRACT(n.`data`, '$.studioScene')) = 'OBJECT';
