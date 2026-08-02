-- Storyboard clip payloads contain structured screenplay and shot details.
-- MySQL TEXT is limited to 65,535 bytes, which is too small for long episodes
-- with multibyte Chinese content.
ALTER TABLE `novel_promotion_clips`
  MODIFY `content` LONGTEXT NOT NULL;
