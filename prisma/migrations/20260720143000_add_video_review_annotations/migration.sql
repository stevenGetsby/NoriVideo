CREATE TABLE `video_review_annotations` (
  `id` VARCHAR(191) NOT NULL,
  `assignmentUuid` VARCHAR(191) NOT NULL,
  `workspaceOwnerId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NULL,
  `panelId` VARCHAR(191) NULL,
  `reviewerUserId` VARCHAR(191) NULL,
  `startMs` INTEGER NOT NULL,
  `endMs` INTEGER NOT NULL,
  `note` TEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'open',
  `resolvedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `video_review_annotations_assignmentUuid_status_startMs_idx` (`assignmentUuid`, `status`, `startMs`),
  INDEX `video_review_annotations_workspaceOwnerId_projectId_episodeId_idx` (`workspaceOwnerId`, `projectId`, `episodeId`),
  INDEX `video_review_annotations_reviewerUserId_createdAt_idx` (`reviewerUserId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `video_review_annotations`
  ADD CONSTRAINT `video_review_annotations_assignmentUuid_fkey`
  FOREIGN KEY (`assignmentUuid`) REFERENCES `workflow_assignments`(`uuid`)
  ON DELETE CASCADE ON UPDATE CASCADE;
