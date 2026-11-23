-- CreateTable
CREATE TABLE `ledger_projects` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceOwnerId` VARCHAR(191) NOT NULL,
    `workId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `nameKey` VARCHAR(191) NOT NULL,
    `category` VARCHAR(16) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'in_progress',
    `startDate` VARCHAR(10) NULL,
    `targetDeliveryDate` VARCHAR(10) NULL,
    `completedDate` VARCHAR(10) NULL,
    `budgetCny` DECIMAL(18, 2) NULL,
    `durationMinutes` DECIMAL(8, 2) NULL,
    `totalEpisodes` INTEGER NULL,
    `doneEpisodes` INTEGER NULL,
    `note` VARCHAR(500) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ledger_projects_owner_name_idx`(`workspaceOwnerId`, `nameKey`),
    INDEX `ledger_projects_owner_arch_idx`(`workspaceOwnerId`, `archivedAt`),
    UNIQUE INDEX `ledger_projects_owner_work_key`(`workspaceOwnerId`, `workId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_daily_facts` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceOwnerId` VARCHAR(191) NOT NULL,
    `ledgerProjectId` VARCHAR(191) NOT NULL,
    `dateKey` VARCHAR(10) NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `actorLabel` VARCHAR(64) NOT NULL,
    `apiType` VARCHAR(16) NOT NULL,
    `costCny` DECIMAL(18, 6) NOT NULL,
    `callCount` INTEGER NOT NULL DEFAULT 0,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ledger_facts_owner_date_idx`(`workspaceOwnerId`, `dateKey`),
    INDEX `ledger_facts_actor_date_idx`(`actorUserId`, `dateKey`),
    UNIQUE INDEX `ledger_facts_uniq`(`ledgerProjectId`, `dateKey`, `actorUserId`, `apiType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_entries` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceOwnerId` VARCHAR(191) NOT NULL,
    `ledgerProjectId` VARCHAR(191) NOT NULL,
    `dateKey` VARCHAR(10) NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `actorLabel` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `quantity` DECIMAL(20, 4) NOT NULL,
    `rate` DECIMAL(18, 6) NOT NULL,
    `amountCny` DECIMAL(18, 6) NOT NULL,
    `remark` VARCHAR(500) NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'manual',
    `importKey` VARCHAR(191) NULL,
    `importBatchId` VARCHAR(64) NULL,
    `replacesEntryId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `voidedAt` DATETIME(3) NULL,
    `voidedById` VARCHAR(191) NULL,

    UNIQUE INDEX `ledger_entries_import_key`(`importKey`),
    INDEX `ledger_entries_owner_date_idx`(`workspaceOwnerId`, `dateKey`),
    INDEX `ledger_entries_project_date_idx`(`ledgerProjectId`, `dateKey`),
    INDEX `ledger_entries_actor_date_idx`(`actorUserId`, `dateKey`),
    INDEX `ledger_entries_batch_idx`(`importBatchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_settings` (
    `workspaceOwnerId` VARCHAR(191) NOT NULL,
    `tokenRateCnyPerMillion` DECIMAL(18, 6) NOT NULL DEFAULT 46,
    `jimengCnyPerPoint` DECIMAL(18, 6) NOT NULL DEFAULT 0.1,
    `syncedThroughDate` VARCHAR(10) NULL,
    `lastSyncAt` DATETIME(3) NULL,
    `syncLockedUntil` DATETIME(3) NULL,
    `updatedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`workspaceOwnerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ledger_daily_facts` ADD CONSTRAINT `ledger_daily_facts_ledgerProjectId_fkey` FOREIGN KEY (`ledgerProjectId`) REFERENCES `ledger_projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_ledgerProjectId_fkey` FOREIGN KEY (`ledgerProjectId`) REFERENCES `ledger_projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
