CREATE TABLE `screenwriter_tasks` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `taskKind` VARCHAR(64) NOT NULL DEFAULT 'video_repaint_2',
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `activeTaskLabel` VARCHAR(64) NULL,
  `currentStage` VARCHAR(64) NOT NULL DEFAULT 'auto_split',
  `currentStageStatus` VARCHAR(32) NOT NULL DEFAULT 'queued',
  `episodeCount` INTEGER NOT NULL DEFAULT 1,
  `requirement` TEXT NOT NULL,
  `transferForm` VARCHAR(32) NOT NULL DEFAULT 'script',
  `uploadMode` VARCHAR(32) NOT NULL DEFAULT 'file',
  `checkpointConfig` JSON NULL,
  `sourceProjectId` VARCHAR(191) NULL,
  `targetProjectId` VARCHAR(191) NULL,
  `activeRunId` VARCHAR(191) NULL,
  `activeWorkerTaskId` VARCHAR(191) NULL,
  `archivedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `screenwriter_tasks_userId_status_idx` ON `screenwriter_tasks`(`userId`, `status`);
CREATE INDEX `screenwriter_tasks_userId_updatedAt_idx` ON `screenwriter_tasks`(`userId`, `updatedAt`);
CREATE INDEX `screenwriter_tasks_taskKind_idx` ON `screenwriter_tasks`(`taskKind`);
CREATE INDEX `screenwriter_tasks_currentStage_currentStageStatus_idx` ON `screenwriter_tasks`(`currentStage`, `currentStageStatus`);

ALTER TABLE `screenwriter_tasks`
  ADD CONSTRAINT `screenwriter_tasks_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `screenwriter_source_videos` (
  `id` VARCHAR(191) NOT NULL,
  `screenwriterTaskId` VARCHAR(191) NOT NULL,
  `episodeNumber` INTEGER NOT NULL DEFAULT 1,
  `fileName` VARCHAR(191) NOT NULL,
  `mediaObjectId` VARCHAR(191) NULL,
  `storageKey` TEXT NULL,
  `url` TEXT NULL,
  `durationSeconds` DOUBLE NULL,
  `fileSize` BIGINT NULL,
  `mimeType` VARCHAR(191) NULL,
  `uploadStatus` VARCHAR(32) NOT NULL DEFAULT 'local',
  `transcodeStatus` VARCHAR(191) NULL,
  `extractStatus` VARCHAR(191) NULL,
  `errorMessage` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `screenwriter_source_videos_screenwriterTaskId_episodeNumber_key` ON `screenwriter_source_videos`(`screenwriterTaskId`, `episodeNumber`);
CREATE INDEX `screenwriter_source_videos_screenwriterTaskId_idx` ON `screenwriter_source_videos`(`screenwriterTaskId`);
CREATE INDEX `screenwriter_source_videos_mediaObjectId_idx` ON `screenwriter_source_videos`(`mediaObjectId`);

ALTER TABLE `screenwriter_source_videos`
  ADD CONSTRAINT `screenwriter_source_videos_screenwriterTaskId_fkey`
  FOREIGN KEY (`screenwriterTaskId`) REFERENCES `screenwriter_tasks`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `screenwriter_source_videos`
  ADD CONSTRAINT `screenwriter_source_videos_mediaObjectId_fkey`
  FOREIGN KEY (`mediaObjectId`) REFERENCES `media_objects`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `screenwriter_stage_states` (
  `id` VARCHAR(191) NOT NULL,
  `screenwriterTaskId` VARCHAR(191) NOT NULL,
  `stageKey` VARCHAR(64) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `subtitle` TEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'not_started',
  `checkpoint` VARCHAR(8) NULL,
  `progress` INTEGER NOT NULL DEFAULT 0,
  `workerTaskId` VARCHAR(191) NULL,
  `runId` VARCHAR(191) NULL,
  `errorCode` VARCHAR(80) NULL,
  `errorMessage` TEXT NULL,
  `startedAt` DATETIME(3) NULL,
  `finishedAt` DATETIME(3) NULL,
  `approvedAt` DATETIME(3) NULL,
  `approvedBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `screenwriter_stage_states_screenwriterTaskId_stageKey_key` ON `screenwriter_stage_states`(`screenwriterTaskId`, `stageKey`);
CREATE INDEX `screenwriter_stage_states_screenwriterTaskId_status_idx` ON `screenwriter_stage_states`(`screenwriterTaskId`, `status`);

ALTER TABLE `screenwriter_stage_states`
  ADD CONSTRAINT `screenwriter_stage_states_screenwriterTaskId_fkey`
  FOREIGN KEY (`screenwriterTaskId`) REFERENCES `screenwriter_tasks`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `screenwriter_settings_reviews` (
  `id` VARCHAR(191) NOT NULL,
  `screenwriterTaskId` VARCHAR(191) NOT NULL,
  `stageKey` VARCHAR(64) NOT NULL,
  `checkpoint` VARCHAR(8) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `outlineTitle` VARCHAR(191) NOT NULL,
  `bodySections` JSON NOT NULL,
  `collapsedPanelTitle` VARCHAR(191) NOT NULL,
  `nameIndexGroups` JSON NULL,
  `mappingGroups` JSON NULL,
  `issues` JSON NULL,
  `feedbackPlaceholder` TEXT NOT NULL,
  `latestFeedback` TEXT NULL,
  `approvedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `screenwriter_settings_reviews_screenwriterTaskId_stageKey_version_key` ON `screenwriter_settings_reviews`(`screenwriterTaskId`, `stageKey`, `version`);
CREATE INDEX `screenwriter_settings_reviews_screenwriterTaskId_stageKey_status_idx` ON `screenwriter_settings_reviews`(`screenwriterTaskId`, `stageKey`, `status`);

ALTER TABLE `screenwriter_settings_reviews`
  ADD CONSTRAINT `screenwriter_settings_reviews_screenwriterTaskId_fkey`
  FOREIGN KEY (`screenwriterTaskId`) REFERENCES `screenwriter_tasks`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `screenwriter_review_feedback` (
  `id` VARCHAR(191) NOT NULL,
  `settingsReviewId` VARCHAR(191) NULL,
  `screenwriterTaskId` VARCHAR(191) NOT NULL,
  `stageKey` VARCHAR(64) NOT NULL,
  `content` TEXT NULL,
  `action` VARCHAR(32) NOT NULL,
  `runId` VARCHAR(191) NULL,
  `workerTaskId` VARCHAR(191) NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `screenwriter_review_feedback_settingsReviewId_idx` ON `screenwriter_review_feedback`(`settingsReviewId`);
CREATE INDEX `screenwriter_review_feedback_screenwriterTaskId_stageKey_idx` ON `screenwriter_review_feedback`(`screenwriterTaskId`, `stageKey`);

ALTER TABLE `screenwriter_review_feedback`
  ADD CONSTRAINT `screenwriter_review_feedback_settingsReviewId_fkey`
  FOREIGN KEY (`settingsReviewId`) REFERENCES `screenwriter_settings_reviews`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `screenwriter_review_feedback`
  ADD CONSTRAINT `screenwriter_review_feedback_screenwriterTaskId_fkey`
  FOREIGN KEY (`screenwriterTaskId`) REFERENCES `screenwriter_tasks`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `screenwriter_episode_processes` (
  `id` VARCHAR(191) NOT NULL,
  `screenwriterTaskId` VARCHAR(191) NOT NULL,
  `stageKey` VARCHAR(64) NOT NULL,
  `episodeNumber` INTEGER NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `workerTaskId` VARCHAR(191) NULL,
  `runId` VARCHAR(191) NULL,
  `sourceEpisodeId` VARCHAR(191) NULL,
  `targetEpisodeId` VARCHAR(191) NULL,
  `progress` INTEGER NOT NULL DEFAULT 0,
  `errorCode` VARCHAR(80) NULL,
  `errorMessage` TEXT NULL,
  `startedAt` DATETIME(3) NULL,
  `finishedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `screenwriter_episode_processes_screenwriterTaskId_stageKey_episodeNumber_key` ON `screenwriter_episode_processes`(`screenwriterTaskId`, `stageKey`, `episodeNumber`);
CREATE INDEX `screenwriter_episode_processes_screenwriterTaskId_stageKey_status_idx` ON `screenwriter_episode_processes`(`screenwriterTaskId`, `stageKey`, `status`);

ALTER TABLE `screenwriter_episode_processes`
  ADD CONSTRAINT `screenwriter_episode_processes_screenwriterTaskId_fkey`
  FOREIGN KEY (`screenwriterTaskId`) REFERENCES `screenwriter_tasks`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `screenwriter_script_episodes` (
  `id` VARCHAR(191) NOT NULL,
  `screenwriterTaskId` VARCHAR(191) NOT NULL,
  `episodeNumber` INTEGER NOT NULL,
  `scriptKind` VARCHAR(32) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `content` LONGTEXT NOT NULL,
  `wordCount` INTEGER NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `sourceVideoId` VARCHAR(191) NULL,
  `sourceEpisodeId` VARCHAR(191) NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `updatedBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `screenwriter_script_episodes_screenwriterTaskId_scriptKind_episodeNumber_version_key` ON `screenwriter_script_episodes`(`screenwriterTaskId`, `scriptKind`, `episodeNumber`, `version`);
CREATE INDEX `screenwriter_script_episodes_screenwriterTaskId_scriptKind_idx` ON `screenwriter_script_episodes`(`screenwriterTaskId`, `scriptKind`);
CREATE INDEX `screenwriter_script_episodes_sourceVideoId_idx` ON `screenwriter_script_episodes`(`sourceVideoId`);

ALTER TABLE `screenwriter_script_episodes`
  ADD CONSTRAINT `screenwriter_script_episodes_screenwriterTaskId_fkey`
  FOREIGN KEY (`screenwriterTaskId`) REFERENCES `screenwriter_tasks`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `screenwriter_script_episodes`
  ADD CONSTRAINT `screenwriter_script_episodes_sourceVideoId_fkey`
  FOREIGN KEY (`sourceVideoId`) REFERENCES `screenwriter_source_videos`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `screenwriter_name_mappings` (
  `id` VARCHAR(191) NOT NULL,
  `screenwriterTaskId` VARCHAR(191) NOT NULL,
  `mappingKind` VARCHAR(32) NOT NULL,
  `sourceName` VARCHAR(191) NOT NULL,
  `targetName` VARCHAR(191) NULL,
  `aliases` JSON NULL,
  `description` TEXT NULL,
  `sourceEvidence` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `screenwriter_name_mappings_screenwriterTaskId_mappingKind_idx` ON `screenwriter_name_mappings`(`screenwriterTaskId`, `mappingKind`);

ALTER TABLE `screenwriter_name_mappings`
  ADD CONSTRAINT `screenwriter_name_mappings_screenwriterTaskId_fkey`
  FOREIGN KEY (`screenwriterTaskId`) REFERENCES `screenwriter_tasks`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `screenwriter_artifacts` (
  `id` VARCHAR(191) NOT NULL,
  `screenwriterTaskId` VARCHAR(191) NOT NULL,
  `stageKey` VARCHAR(64) NOT NULL,
  `artifactType` VARCHAR(80) NOT NULL,
  `refId` VARCHAR(191) NOT NULL,
  `payload` JSON NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `runId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `screenwriter_artifacts_screenwriterTaskId_stageKey_artifactType_refId_version_key` ON `screenwriter_artifacts`(`screenwriterTaskId`, `stageKey`, `artifactType`, `refId`, `version`);
CREATE INDEX `screenwriter_artifacts_screenwriterTaskId_stageKey_idx` ON `screenwriter_artifacts`(`screenwriterTaskId`, `stageKey`);

ALTER TABLE `screenwriter_artifacts`
  ADD CONSTRAINT `screenwriter_artifacts_screenwriterTaskId_fkey`
  FOREIGN KEY (`screenwriterTaskId`) REFERENCES `screenwriter_tasks`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
