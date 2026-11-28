-- Add screenshot attachments, client diagnostic context, and loop resolutionNote to workspace_feedback_records.
-- Additive & idempotent MySQL 8.0 DDL matching prisma/schema.prisma 1:1.

SET @has_attachments := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workspace_feedback_records'
    AND COLUMN_NAME = 'attachments'
);
SET @sql_add_attachments := IF(
  @has_attachments = 0,
  'ALTER TABLE `workspace_feedback_records` ADD COLUMN `attachments` JSON NULL AFTER `userAgent`',
  'SELECT 1'
);
PREPARE stmt_add_attachments FROM @sql_add_attachments;
EXECUTE stmt_add_attachments;
DEALLOCATE PREPARE stmt_add_attachments;

SET @has_context := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workspace_feedback_records'
    AND COLUMN_NAME = 'context'
);
SET @sql_add_context := IF(
  @has_context = 0,
  'ALTER TABLE `workspace_feedback_records` ADD COLUMN `context` JSON NULL AFTER `attachments`',
  'SELECT 1'
);
PREPARE stmt_add_context FROM @sql_add_context;
EXECUTE stmt_add_context;
DEALLOCATE PREPARE stmt_add_context;

SET @has_resolution_note := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workspace_feedback_records'
    AND COLUMN_NAME = 'resolutionNote'
);
SET @sql_add_resolution_note := IF(
  @has_resolution_note = 0,
  'ALTER TABLE `workspace_feedback_records` ADD COLUMN `resolutionNote` TEXT NULL AFTER `context`',
  'SELECT 1'
);
PREPARE stmt_add_resolution_note FROM @sql_add_resolution_note;
EXECUTE stmt_add_resolution_note;
DEALLOCATE PREPARE stmt_add_resolution_note;
