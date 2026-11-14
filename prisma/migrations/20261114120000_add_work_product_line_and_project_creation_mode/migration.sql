-- Separate ordinary canvas 项目 from interactive 影游.
ALTER TABLE `works` ADD COLUMN `productLine` VARCHAR(16) NOT NULL DEFAULT 'canvas';
CREATE INDEX `works_workspaceOwnerId_productLine_idx` ON `works`(`workspaceOwnerId`, `productLine`);

-- Remember which editor a 作品 was created in so cover clicks can route correctly.
ALTER TABLE `projects` ADD COLUMN `creationMode` VARCHAR(16) NOT NULL DEFAULT 'workflow';
