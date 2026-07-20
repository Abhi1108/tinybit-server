-- Persist exact Gemini usageMetadata on Sathi chat turns.
-- Safe to re-run: skips columns that already exist (MySQL 8.0.12+ information_schema check).

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_conversations' AND COLUMN_NAME = 'prompt_tokens'
    ),
    'SELECT 1',
    'ALTER TABLE ai_conversations ADD COLUMN prompt_tokens INT NULL AFTER provider'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_conversations' AND COLUMN_NAME = 'completion_tokens'
    ),
    'SELECT 1',
    'ALTER TABLE ai_conversations ADD COLUMN completion_tokens INT NULL AFTER prompt_tokens'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ai_conversations' AND COLUMN_NAME = 'total_tokens'
    ),
    'SELECT 1',
    'ALTER TABLE ai_conversations ADD COLUMN total_tokens INT NULL AFTER completion_tokens'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
