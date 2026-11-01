ALTER TABLE `work_members` ADD COLUMN `permissions` JSON NULL;

ALTER TABLE `project_members`
  ADD COLUMN `role` VARCHAR(32) NOT NULL DEFAULT 'member',
  ADD COLUMN `permissions` JSON NULL;
