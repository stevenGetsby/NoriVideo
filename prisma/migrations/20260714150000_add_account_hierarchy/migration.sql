ALTER TABLE `user`
  ADD COLUMN `parentAccountId` VARCHAR(191) NULL;

CREATE INDEX `user_parentAccountId_role_status_idx`
  ON `user`(`parentAccountId`, `role`, `status`);

-- Keep the existing xyz workspace in place while making its owner the
-- platform-level administrator.
UPDATE `user`
SET
  `role` = 'super_admin',
  `workspaceOwnerId` = NULL,
  `parentAccountId` = NULL
WHERE `name` = 'xyz';

-- Other installations get one deterministic platform administrator.
UPDATE `user`
SET
  `role` = 'super_admin',
  `workspaceOwnerId` = NULL,
  `parentAccountId` = NULL
WHERE `id` = (
  SELECT `id`
  FROM (
    SELECT `id`
    FROM `user`
    ORDER BY (`role` = 'admin') DESC, `createdAt` ASC, `id` ASC
    LIMIT 1
  ) AS `platform_owner`
)
AND NOT EXISTS (
  SELECT 1
  FROM (
    SELECT `role`
    FROM `user`
  ) AS `existing_platform_owners`
  WHERE `role` = 'super_admin'
);

-- Existing management accounts become children of the platform Admin.
UPDATE `user`
SET
  `parentAccountId` = (
    SELECT `id`
    FROM (
      SELECT `id`
      FROM `user`
      WHERE `role` = 'super_admin'
      ORDER BY `createdAt` ASC, `id` ASC
      LIMIT 1
    ) AS `platform_owner`
  ),
  `workspaceOwnerId` = NULL
WHERE `role` = 'admin';

-- Mirror the existing workspace assignment into the explicit hierarchy.
UPDATE `user` AS `member`
INNER JOIN `user` AS `manager`
  ON `member`.`workspaceOwnerId` = `manager`.`id`
SET `member`.`parentAccountId` = `manager`.`id`
WHERE `member`.`role` IN ('writer', 'asset', 'storyboard')
  AND `manager`.`role` IN ('super_admin', 'admin');

-- Repair any legacy unassigned subaccount without moving owned workspace data.
UPDATE `user`
SET
  `workspaceOwnerId` = (
    SELECT `id`
    FROM (
      SELECT `id`
      FROM `user`
      WHERE `role` = 'super_admin'
      ORDER BY `createdAt` ASC, `id` ASC
      LIMIT 1
    ) AS `platform_owner`
  ),
  `parentAccountId` = (
    SELECT `id`
    FROM (
      SELECT `id`
      FROM `user`
      WHERE `role` = 'super_admin'
      ORDER BY `createdAt` ASC, `id` ASC
      LIMIT 1
    ) AS `platform_owner`
  )
WHERE `role` IN ('writer', 'asset', 'storyboard')
  AND `parentAccountId` IS NULL;

ALTER TABLE `user`
  ADD CONSTRAINT `user_parentAccountId_fkey`
  FOREIGN KEY (`parentAccountId`) REFERENCES `user`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
