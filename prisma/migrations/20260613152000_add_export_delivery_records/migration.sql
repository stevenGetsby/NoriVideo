CREATE TABLE `export_history_records` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `scopeId` VARCHAR(128) NOT NULL DEFAULT 'project',
  `episodeId` VARCHAR(128) NULL,
  `cardId` VARCHAR(64) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `fileName` TEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'completed',
  `source` VARCHAR(32) NOT NULL DEFAULT 'persistent',
  `stats` JSON NULL,
  `manifest` JSON NULL,
  `taskId` VARCHAR(191) NULL,
  `outputStorageKey` TEXT NULL,
  `outputUrl` TEXT NULL,
  `contentType` VARCHAR(128) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `export_history_records_userId_projectId_scopeId_createdAt_idx`
  ON `export_history_records`(`userId`, `projectId`, `scopeId`, `createdAt`);

CREATE INDEX `export_history_records_projectId_scopeId_idx`
  ON `export_history_records`(`projectId`, `scopeId`);

CREATE INDEX `export_history_records_cardId_idx`
  ON `export_history_records`(`cardId`);

CREATE INDEX `export_history_records_taskId_idx`
  ON `export_history_records`(`taskId`);

ALTER TABLE `export_history_records`
  ADD CONSTRAINT `export_history_records_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `export_history_records`
  ADD CONSTRAINT `export_history_records_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `export_queue_records` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `scopeId` VARCHAR(128) NOT NULL DEFAULT 'project',
  `episodeId` VARCHAR(128) NULL,
  `cardId` VARCHAR(64) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
  `blocker` TEXT NULL,
  `taskId` VARCHAR(191) NULL,
  `outputFileName` TEXT NULL,
  `outputStorageKey` TEXT NULL,
  `outputUrl` TEXT NULL,
  `contentType` VARCHAR(128) NULL,
  `outputManifest` JSON NULL,
  `stats` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `export_queue_records_userId_projectId_scopeId_cardId_key`
  ON `export_queue_records`(`userId`, `projectId`, `scopeId`, `cardId`);

CREATE INDEX `export_queue_records_projectId_scopeId_idx`
  ON `export_queue_records`(`projectId`, `scopeId`);

CREATE INDEX `export_queue_records_status_idx`
  ON `export_queue_records`(`status`);

CREATE INDEX `export_queue_records_taskId_idx`
  ON `export_queue_records`(`taskId`);

ALTER TABLE `export_queue_records`
  ADD CONSTRAINT `export_queue_records_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `export_queue_records`
  ADD CONSTRAINT `export_queue_records_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
