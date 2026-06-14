CREATE TABLE `workspace_feedback_records` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(32) NOT NULL DEFAULT 'bug',
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NOT NULL,
  `route` TEXT NULL,
  `userAgent` TEXT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'open',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `workspace_feedback_records_userId_createdAt_idx`
  ON `workspace_feedback_records`(`userId`, `createdAt`);

CREATE INDEX `workspace_feedback_records_userId_status_idx`
  ON `workspace_feedback_records`(`userId`, `status`);

CREATE INDEX `workspace_feedback_records_type_idx`
  ON `workspace_feedback_records`(`type`);

ALTER TABLE `workspace_feedback_records`
  ADD CONSTRAINT `workspace_feedback_records_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `system_update_check_records` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `checkedAt` DATETIME(3) NOT NULL,
  `version` VARCHAR(64) NOT NULL,
  `bootId` VARCHAR(128) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'current',
  `modules` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `system_update_check_records_userId_checkedAt_idx`
  ON `system_update_check_records`(`userId`, `checkedAt`);

CREATE INDEX `system_update_check_records_userId_createdAt_idx`
  ON `system_update_check_records`(`userId`, `createdAt`);

CREATE INDEX `system_update_check_records_status_idx`
  ON `system_update_check_records`(`status`);

ALTER TABLE `system_update_check_records`
  ADD CONSTRAINT `system_update_check_records_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
