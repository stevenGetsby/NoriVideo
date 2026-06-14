CREATE TABLE `workflow_stage_states` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `scopeId` VARCHAR(128) NOT NULL DEFAULT 'project',
  `stageKey` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'idle',
  `progress` INTEGER NULL,
  `blocker` TEXT NULL,
  `reviewState` VARCHAR(32) NULL,
  `lastRunId` VARCHAR(191) NULL,
  `lastTaskId` VARCHAR(191) NULL,
  `summary` JSON NULL,
  `errorCode` VARCHAR(191) NULL,
  `errorMessage` TEXT NULL,
  `approvedAt` DATETIME(3) NULL,
  `approvedBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `workflow_stage_states_userId_projectId_scopeId_stageKey_key`
  ON `workflow_stage_states`(`userId`, `projectId`, `scopeId`, `stageKey`);

CREATE INDEX `workflow_stage_states_projectId_scopeId_idx`
  ON `workflow_stage_states`(`projectId`, `scopeId`);

CREATE INDEX `workflow_stage_states_userId_idx`
  ON `workflow_stage_states`(`userId`);

CREATE INDEX `workflow_stage_states_status_idx`
  ON `workflow_stage_states`(`status`);

ALTER TABLE `workflow_stage_states`
  ADD CONSTRAINT `workflow_stage_states_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workflow_stage_states`
  ADD CONSTRAINT `workflow_stage_states_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
