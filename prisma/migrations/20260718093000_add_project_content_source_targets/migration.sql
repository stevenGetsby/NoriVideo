ALTER TABLE `novel_promotion_projects`
  ADD COLUMN `contentType` VARCHAR(32) NOT NULL DEFAULT 'story',
  ADD COLUMN `materialType` VARCHAR(32) NOT NULL DEFAULT 'script',
  ADD COLUMN `targetEpisodeCount` INTEGER NOT NULL DEFAULT 0;

UPDATE `novel_promotion_projects`
SET `contentType` = 'narration'
WHERE `workflowMode` = 'narration';
