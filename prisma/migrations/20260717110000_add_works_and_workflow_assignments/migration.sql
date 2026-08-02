-- Add the FrameOS-compatible work grouping and human collaboration task domain.
-- Existing projects are first attached to one deterministic default work per workspace.

CREATE TABLE `works` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceOwnerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `works_workspaceOwnerId_updatedAt_idx`(`workspaceOwnerId`, `updatedAt`),
    INDEX `works_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `projects`
    ADD COLUMN `workId` VARCHAR(191) NULL,
    ADD COLUMN `createdById` VARCHAR(191) NULL,
    ADD COLUMN `collaborationMode` VARCHAR(32) NOT NULL DEFAULT 'solo';

INSERT INTO `works` (`id`, `workspaceOwnerId`, `name`, `createdById`, `createdAt`, `updatedAt`)
SELECT UUID(), `userId`, '默认作品', `userId`, MIN(`createdAt`), MAX(`updatedAt`)
FROM `projects`
GROUP BY `userId`;

UPDATE `projects` AS `project`
INNER JOIN `works` AS `work`
    ON `work`.`workspaceOwnerId` = `project`.`userId`
   AND `work`.`name` = '默认作品'
SET
    `project`.`workId` = `work`.`id`,
    `project`.`createdById` = `project`.`userId`;

ALTER TABLE `projects`
    MODIFY COLUMN `workId` VARCHAR(191) NOT NULL,
    MODIFY COLUMN `createdById` VARCHAR(191) NOT NULL;

CREATE INDEX `projects_workId_updatedAt_idx` ON `projects`(`workId`, `updatedAt`);
CREATE INDEX `projects_createdById_idx` ON `projects`(`createdById`);

CREATE TABLE `work_members` (
    `id` VARCHAR(191) NOT NULL,
    `workId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(32) NOT NULL DEFAULT 'member',
    `canManage` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `work_members_workId_userId_key`(`workId`, `userId`),
    INDEX `work_members_userId_workId_idx`(`userId`, `workId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_members` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `canManageAssignments` BOOLEAN NOT NULL DEFAULT false,
    `canReviewAssignments` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_members_projectId_userId_key`(`projectId`, `userId`),
    INDEX `project_members_userId_projectId_idx`(`userId`, `projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workflow_assignments` (
    `uuid` VARCHAR(191) NOT NULL,
    `workspaceOwnerId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `episodeId` VARCHAR(191) NULL,
    `scopeId` VARCHAR(191) NOT NULL DEFAULT 'project',
    `stage` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'unassigned',
    `assigneeUserId` VARCHAR(191) NULL,
    `assignedById` VARCHAR(191) NULL,
    `assignedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `lastReviewNote` TEXT NULL,
    `submitCompletesDirectly` BOOLEAN NOT NULL DEFAULT false,
    `matched` BOOLEAN NOT NULL DEFAULT true,
    `sourceTaskId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `workflow_assignments_projectId_scopeId_stage_key`(`projectId`, `scopeId`, `stage`),
    INDEX `workflow_assignments_owner_assignee_status_idx`(`workspaceOwnerId`, `assigneeUserId`, `status`, `updatedAt`),
    INDEX `workflow_assignments_projectId_status_idx`(`projectId`, `status`),
    INDEX `workflow_assignments_episodeId_stage_idx`(`episodeId`, `stage`),
    INDEX `workflow_assignments_assignedById_idx`(`assignedById`),
    PRIMARY KEY (`uuid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workflow_assignment_events` (
    `id` VARCHAR(191) NOT NULL,
    `assignmentUuid` VARCHAR(191) NOT NULL,
    `workspaceOwnerId` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(64) NOT NULL,
    `fromStatus` VARCHAR(32) NULL,
    `toStatus` VARCHAR(32) NULL,
    `note` TEXT NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workflow_assignment_events_assignmentUuid_createdAt_idx`(`assignmentUuid`, `createdAt`),
    INDEX `workflow_assignment_events_workspaceOwnerId_createdAt_idx`(`workspaceOwnerId`, `createdAt`),
    INDEX `workflow_assignment_events_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `works`
    ADD CONSTRAINT `works_workspaceOwnerId_fkey`
        FOREIGN KEY (`workspaceOwnerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `works_createdById_fkey`
        FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `projects`
    ADD CONSTRAINT `projects_workId_fkey`
        FOREIGN KEY (`workId`) REFERENCES `works`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `projects_createdById_fkey`
        FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `work_members`
    ADD CONSTRAINT `work_members_workId_fkey`
        FOREIGN KEY (`workId`) REFERENCES `works`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `work_members_userId_fkey`
        FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_members`
    ADD CONSTRAINT `project_members_projectId_fkey`
        FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `project_members_userId_fkey`
        FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workflow_assignments`
    ADD CONSTRAINT `workflow_assignments_workspaceOwnerId_fkey`
        FOREIGN KEY (`workspaceOwnerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `workflow_assignments_projectId_fkey`
        FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `workflow_assignments_episodeId_fkey`
        FOREIGN KEY (`episodeId`) REFERENCES `novel_promotion_episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `workflow_assignments_assigneeUserId_fkey`
        FOREIGN KEY (`assigneeUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `workflow_assignments_assignedById_fkey`
        FOREIGN KEY (`assignedById`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `workflow_assignment_events`
    ADD CONSTRAINT `workflow_assignment_events_assignmentUuid_fkey`
        FOREIGN KEY (`assignmentUuid`) REFERENCES `workflow_assignments`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `workflow_assignment_events_workspaceOwnerId_fkey`
        FOREIGN KEY (`workspaceOwnerId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `workflow_assignment_events_actorUserId_fkey`
        FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
