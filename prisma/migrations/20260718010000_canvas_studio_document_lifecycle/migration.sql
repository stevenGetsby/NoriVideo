CREATE TABLE `canvas_studio_3d_document_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `snapshotId` VARCHAR(191) NOT NULL,
    `nodeId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL,
    `document` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `canvas_studio_3d_doc_snapshots_snapshot_node_key`(`snapshotId`, `nodeId`),
    INDEX `canvas_studio_3d_doc_snapshots_node_idx`(`nodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `canvas_workflow_template_studio_3d_documents` (
    `id` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `sourceNodeId` VARCHAR(191) NOT NULL,
    `sourceRevision` INTEGER NOT NULL,
    `document` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `canvas_workflow_studio_docs_template_node_key`(`templateId`, `sourceNodeId`),
    INDEX `canvas_workflow_studio_docs_source_node_idx`(`sourceNodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `canvas_studio_3d_document_snapshots`
    ADD CONSTRAINT `canvas_studio_3d_doc_snapshots_snapshot_fk`
    FOREIGN KEY (`snapshotId`) REFERENCES `canvas_snapshots`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `canvas_workflow_template_studio_3d_documents`
    ADD CONSTRAINT `canvas_workflow_studio_docs_template_fk`
    FOREIGN KEY (`templateId`) REFERENCES `canvas_workflow_templates`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
