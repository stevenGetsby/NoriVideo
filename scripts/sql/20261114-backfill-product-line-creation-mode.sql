-- Backfill Work.productLine / Project.creationMode for data created before 2026-11-14.
-- Safe to re-run: every UPDATE is guarded by the value it would write.

-- Dry-run: interactive 影游 works that will become productLine = 'story'.
SELECT COUNT(*) AS story_works
FROM works w
JOIN interactive_stories s ON s.workId = w.id;

-- Dry-run: chapters that will become creationMode = 'canvas'.
SELECT COUNT(*) AS story_chapters
FROM projects p
JOIN interactive_stories s ON s.workId = p.workId;

-- Dry-run: ordinary works whose first canvas appeared within 10s of creation
-- (they were made in the canvas editor, not started in the workbench).
SELECT p.id, p.name, p.createdAt, c.firstCanvasAt
FROM projects p
JOIN (SELECT projectId, MIN(createdAt) AS firstCanvasAt FROM canvases GROUP BY projectId) c ON c.projectId = p.id
LEFT JOIN novel_promotion_projects npp ON npp.projectId = p.id
WHERE p.creationMode = 'workflow'
  AND NOT EXISTS (SELECT 1 FROM interactive_stories s WHERE s.workId = p.workId)
  AND TIMESTAMPDIFF(SECOND, p.createdAt, c.firstCanvasAt) BETWEEN 0 AND 10
  AND NOT EXISTS (SELECT 1 FROM novel_promotion_episodes e WHERE e.novelPromotionProjectId = npp.id)
LIMIT 20;

-- Dry-run: how many rows the third UPDATE would touch.
SELECT COUNT(*) AS canvas_created_projects
FROM projects p
JOIN (SELECT projectId, MIN(createdAt) AS firstCanvasAt FROM canvases GROUP BY projectId) c ON c.projectId = p.id
LEFT JOIN novel_promotion_projects npp ON npp.projectId = p.id
WHERE p.creationMode = 'workflow'
  AND NOT EXISTS (SELECT 1 FROM interactive_stories s WHERE s.workId = p.workId)
  AND TIMESTAMPDIFF(SECOND, p.createdAt, c.firstCanvasAt) BETWEEN 0 AND 10
  AND NOT EXISTS (SELECT 1 FROM novel_promotion_episodes e WHERE e.novelPromotionProjectId = npp.id);

-- 1. Every interactive 影游 work is a story work.
UPDATE works w
JOIN interactive_stories s ON s.workId = w.id
SET w.productLine = 'story'
WHERE w.productLine <> 'story';

-- 2. Chapters inside a 影游 are canvas-mode 作品.
UPDATE projects p
JOIN works w ON w.id = p.workId
SET p.creationMode = 'canvas'
WHERE w.productLine = 'story' AND p.creationMode <> 'canvas';

-- 3. Ordinary works created through the canvas editor. The main canvas is created
-- in the same transaction as the project, so the first canvas lands seconds after
-- creation; workbench-created works open the canvas much later. Works with
-- episodes are always workbench-made and are excluded.
UPDATE projects p
JOIN (SELECT projectId, MIN(createdAt) AS firstCanvasAt FROM canvases GROUP BY projectId) c ON c.projectId = p.id
LEFT JOIN novel_promotion_projects npp ON npp.projectId = p.id
SET p.creationMode = 'canvas'
WHERE p.creationMode = 'workflow'
  AND TIMESTAMPDIFF(SECOND, p.createdAt, c.firstCanvasAt) BETWEEN 0 AND 10
  AND NOT EXISTS (SELECT 1 FROM novel_promotion_episodes e WHERE e.novelPromotionProjectId = npp.id);
