-- Preserve existing hard-delete account semantics while retaining assignment audit rows.
ALTER TABLE `workflow_assignment_events`
    DROP FOREIGN KEY `workflow_assignment_events_actorUserId_fkey`;

ALTER TABLE `projects`
    DROP FOREIGN KEY `projects_createdById_fkey`;

ALTER TABLE `works`
    DROP FOREIGN KEY `works_createdById_fkey`;

ALTER TABLE `workflow_assignment_events`
    MODIFY COLUMN `actorUserId` VARCHAR(191) NULL;

ALTER TABLE `workflow_assignment_events`
    ADD CONSTRAINT `workflow_assignment_events_actorUserId_fkey`
        FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `projects`
    ADD CONSTRAINT `projects_createdById_fkey`
        FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `works`
    ADD CONSTRAINT `works_createdById_fkey`
        FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
