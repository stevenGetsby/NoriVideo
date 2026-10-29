CREATE TABLE `interactive_stories` (
  `id` VARCHAR(191) NOT NULL,
  `workId` VARCHAR(191) NOT NULL,
  `aspectRatio` VARCHAR(16) NOT NULL DEFAULT '9:16',
  `resolution` VARCHAR(16) NOT NULL DEFAULT '1080p',
  `config` JSON NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `interactive_stories_workId_key` (`workId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `interactive_stories`
  ADD CONSTRAINT `interactive_stories_workId_fkey`
  FOREIGN KEY (`workId`) REFERENCES `works`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
