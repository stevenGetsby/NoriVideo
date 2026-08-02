ALTER TABLE `user`
  ADD COLUMN `role` VARCHAR(32) NOT NULL DEFAULT 'writer',
  ADD COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  ADD COLUMN `permissions` JSON NULL,
  ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `lastLoginAt` DATETIME(3) NULL,
  ADD COLUMN `workspaceOwnerId` VARCHAR(191) NULL;

CREATE INDEX `user_role_status_idx` ON `user`(`role`, `status`);
CREATE INDEX `user_workspaceOwnerId_status_idx` ON `user`(`workspaceOwnerId`, `status`);

-- Preserve existing accounts and make the known local administrator the first Owner.
UPDATE `user`
SET `role` = 'admin'
WHERE `name` = 'xyz';

-- On installations without an xyz account, promote the oldest existing account.
UPDATE `user`
SET `role` = 'admin'
WHERE `id` = (
  SELECT `id`
  FROM (
    SELECT `id`
    FROM `user`
    ORDER BY `createdAt` ASC, `id` ASC
    LIMIT 1
  ) AS `first_user`
)
AND NOT EXISTS (
  SELECT 1
  FROM (
    SELECT `role`
    FROM `user`
  ) AS `existing_owners`
  WHERE `role` = 'admin'
);

UPDATE `user`
SET
  `role` = 'writer',
  `workspaceOwnerId` = (
    SELECT `id`
    FROM (
      SELECT `id`
      FROM `user`
      WHERE `role` = 'admin'
      ORDER BY `createdAt` ASC, `id` ASC
      LIMIT 1
    ) AS `first_admin`
  )
WHERE `role` <> 'admin';
