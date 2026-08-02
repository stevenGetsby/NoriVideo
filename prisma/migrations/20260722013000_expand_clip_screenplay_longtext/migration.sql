-- A structured screenplay can contain the full per-shot production prompt.
-- MySQL TEXT is limited to 65,535 bytes and overflows on long Chinese episodes.
ALTER TABLE `novel_promotion_clips`
  MODIFY `content` LONGTEXT NOT NULL,
  MODIFY `screenplay` LONGTEXT NULL;
