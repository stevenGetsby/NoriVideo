CREATE TABLE `workspace_team_profiles` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `mode` VARCHAR(32) NOT NULL DEFAULT 'personal',
  `displayName` VARCHAR(191) NULL,
  `seatLimit` INTEGER NOT NULL DEFAULT 1,
  `settings` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `workspace_team_profiles_userId_key`
  ON `workspace_team_profiles`(`userId`);

CREATE INDEX `workspace_team_profiles_mode_idx`
  ON `workspace_team_profiles`(`mode`);

ALTER TABLE `workspace_team_profiles`
  ADD CONSTRAINT `workspace_team_profiles_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `workspace_team_seats` (
  `id` VARCHAR(191) NOT NULL,
  `profileId` VARCHAR(191) NOT NULL,
  `memberUserId` VARCHAR(191) NULL,
  `role` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'reserved',
  `displayName` VARCHAR(191) NULL,
  `email` VARCHAR(191) NULL,
  `permissions` JSON NULL,
  `lastActivityAt` DATETIME(3) NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `workspace_team_seats_profileId_role_key`
  ON `workspace_team_seats`(`profileId`, `role`);

CREATE INDEX `workspace_team_seats_memberUserId_role_idx`
  ON `workspace_team_seats`(`memberUserId`, `role`);

CREATE INDEX `workspace_team_seats_status_idx`
  ON `workspace_team_seats`(`status`);

ALTER TABLE `workspace_team_seats`
  ADD CONSTRAINT `workspace_team_seats_profileId_fkey`
  FOREIGN KEY (`profileId`) REFERENCES `workspace_team_profiles`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace_team_seats`
  ADD CONSTRAINT `workspace_team_seats_memberUserId_fkey`
  FOREIGN KEY (`memberUserId`) REFERENCES `user`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
