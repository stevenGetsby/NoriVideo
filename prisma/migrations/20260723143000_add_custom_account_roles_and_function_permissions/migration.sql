ALTER TABLE `user`
  ADD COLUMN `roleLabel` VARCHAR(64) NULL;

UPDATE `user`
SET `roleLabel` = CASE
  WHEN `role` = 'writer' THEN '编剧'
  WHEN `role` = 'asset' THEN '资产师'
  WHEN `role` = 'storyboard' THEN '分镜师'
  ELSE NULL
END
WHERE `status` <> 'deleted';

-- The previous shared creativeGenerate permission is split into two
-- independently configurable functional areas. Existing accounts keep the
-- same effective access after the migration.
UPDATE `user`
SET `permissions` = CASE
  WHEN `role` IN ('super_admin', 'admin')
    THEN JSON_ARRAY('read', 'scriptWrite', 'assetWrite', 'storyboardWrite', 'toolboxUse', 'canvasWrite', 'admin')
  WHEN `role` = 'asset'
    THEN JSON_ARRAY('read', 'assetWrite', 'toolboxUse', 'canvasWrite')
  WHEN `role` = 'storyboard'
    THEN JSON_ARRAY('read', 'storyboardWrite', 'toolboxUse', 'canvasWrite')
  ELSE JSON_ARRAY('read', 'scriptWrite', 'toolboxUse', 'canvasWrite')
END
WHERE `status` <> 'deleted';
