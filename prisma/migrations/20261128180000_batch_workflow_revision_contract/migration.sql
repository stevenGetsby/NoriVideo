-- Phase 0 additive contracts: BatchItem CAS / execution identity and immutable Skill versions.
--
-- MySQL unique indexes treat NULL userId values as distinct, so built-in Skill rows
-- (userId IS NULL) do not collide with one another. Custom workspace rows are checked.
--
-- REQUIRED PRECHECK before applying this migration OR an equivalent `prisma db push`.
-- Stop if this returns rows; db push otherwise fails while creating the unique index:
--
-- SELECT `userId`, `slug`, `version`, COUNT(*) AS `duplicateCount`,
--        GROUP_CONCAT(`id` ORDER BY `createdAt`, `id`) AS `skillIds`
-- FROM `workflow_skills`
-- WHERE `userId` IS NOT NULL
-- GROUP BY `userId`, `slug`, `version`
-- HAVING COUNT(*) > 1;
--
-- Deduplication requires a human-reviewed version remap, never blind deletion:
-- preserve historical IDs referenced by BatchRun.templateSnapshot and BatchItem.stageStates;
-- choose the authoritative row, publish other content as new monotonically increasing versions,
-- update template/snapshot references deliberately, and only then delete unreferenced duplicates.
-- MySQL does not support ALTER TABLE IF NOT EXISTS consistently across supported versions;
-- these statements are intentionally one-shot and must be run through the migration runner.

ALTER TABLE `batch_items`
  ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 0 AFTER `batchRunId`,
  ADD COLUMN `executionKey` VARCHAR(191) NULL AFTER `revision`;

CREATE UNIQUE INDEX `workflow_skills_userId_slug_version_key`
  ON `workflow_skills` (`userId`, `slug`, `version`);
