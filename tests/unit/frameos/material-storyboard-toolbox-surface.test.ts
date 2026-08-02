import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findActiveMention,
  splitPromptMentionParts,
} from '@/components/frameos/materials/mention-prompt'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('FrameOS material, storyboard, production, and toolbox surfaces', () => {
  it('requires a local upload name and exposes the same picker inside storyboard', () => {
    const picker = readSource('src/components/frameos/materials/MaterialPickerDialog.tsx')
    const materialRoute = readSource('src/app/api/frameos/materials/route.ts')
    const materialUpload = readSource('src/lib/frameos/material-upload.ts')
    const storyboard = readSource('src/components/frameos/views/FosStoryboard.tsx')

    expect(picker).toContain("form.set('title', uploadName.trim())")
    expect(picker).toContain('素材名称（必填）')
    expect(materialRoute).toContain('uploadFrameosMaterial')
    expect(materialUpload).toContain('if (!file || !title)')
    expect(storyboard).toContain('<MaterialPickerDialog')
    expect(storyboard).toContain('<MentionPromptEditor')
    expect(storyboard).not.toContain('添加额外参考素材')
  })

  it('detects an @ query only at the active cursor mention', () => {
    expect(findActiveMention('镜头跟随 @苏晚', 9)).toEqual({ query: '苏晚', start: 5 })
    expect(findActiveMention('镜头跟随 @苏晚，随后停下', 13)).toBeNull()
    expect(findActiveMention('已有 @苏晚卿\n@柴', 10)).toEqual({ query: '柴', start: 8 })
  })

  it('highlights complete bound @asset names without changing prompt text', () => {
    const value = '@苏晚卿站在@破旧柴房，手持@银簪。普通文字不变。'
    const parts = splitPromptMentionParts(value, [
      { name: '苏晚卿' },
      { name: '破旧柴房' },
      { name: '银簪' },
    ])

    expect(parts.map((part) => part.text).join('')).toBe(value)
    expect(parts.filter((part) => part.mention).map((part) => part.text)).toEqual([
      '@苏晚卿',
      '@破旧柴房',
      '@银簪',
    ])
  })

  it('keeps video generation in production shot and supports both toolbox media types', () => {
    const production = readSource('src/components/frameos/views/FosProductionShot.tsx')
    const workflow = readSource('src/components/frameos/FosWorkflowClient.tsx')
    const overview = readSource('src/components/frameos/views/FosWorkbenchOverview.tsx')
    const toolbox = readSource('src/components/frameos/views/FosToolbox.tsx')
    const toolboxRoute = readSource('src/app/api/frameos/toolbox/generate/route.ts')

    expect(production).toContain('/generate-video')
    expect(workflow).toContain("shot: '制作剪辑工作台'")
    expect(overview).toContain('`${base}/production/episodes`')
    expect(production).toContain('<MaterialPickerDialog')
    expect(toolbox).toContain("{ key: 'image', label: '图片生成'")
    expect(toolbox).toContain("{ key: 'video', label: '视频生成'")
    expect(toolbox).toContain('<MaterialPickerDialog')
    expect(toolboxRoute).toContain('TASK_TYPE.TOOLBOX_IMAGE')
    expect(toolboxRoute).toContain('TASK_TYPE.TOOLBOX_VIDEO')
    expect(toolboxRoute).toContain('TASK_TYPE.TOOLBOX_MODEL_3D')
  })

  it('uses a compact 4-15 second selector instead of a horizontal duration strip', () => {
    const toolbox = readSource('src/components/frameos/views/FosToolbox.tsx')
    expect(toolbox).toContain('TOOLBOX_VIDEO_DURATIONS')
    expect(toolbox).toContain('aria-label="视频时长"')
    expect(toolbox).toContain('4–15 秒')
    expect(toolbox).not.toContain('durationOptions.map((value) => `${value}s`)')
  })

  it('shows only persisted storyboards and exposes real extraction and deletion actions', () => {
    const projects = readSource('src/components/frameos/FosProjectsClient.tsx')
    const assets = readSource('src/components/frameos/views/FosAssetSetting.tsx')
    const storyboard = readSource('src/components/frameos/views/FosStoryboard.tsx')
    const projectModels = readSource('src/components/frameos/FosProjectModelConfigDialog.tsx')
    const toolbox = readSource('src/components/frameos/views/FosToolbox.tsx')
    const overview = readSource('src/components/frameos/views/FosWorkbenchOverview.tsx')

    expect(projects).toContain("method: 'DELETE'")
    expect(projects).toContain('<ConfirmActionDialog')
    expect(projects).toContain("title={confirmTarget.kind === 'work' ? '删除作品' : '删除项目'}")
    expect(projects).toContain('confirmLabel="确认删除"')
    expect(projects).toContain('onConfirm={confirmDelete}')
    expect(assets).toContain('解析剧本资产')
    expect(assets).toContain('/api/tasks?')
    expect(assets).toContain('allImageTargets')
    expect(assets).toContain('handleGenerateOne')
    expect(assets).toContain('一键生成全部主图和变体图')
    expect(assets).not.toContain("['16:21', 'character_image'")
    expect(storyboard).toContain('本集尚未解析分镜')
    expect(storyboard).toContain('解析本集分镜')
    expect(storyboard).toContain('data-testid="episode-storyboard-progress"')
    expect(storyboard).toContain('useTaskTargetStateMap')
    expect(storyboard).not.toContain("apiFetch('/api/runs'")
    expect(storyboard).not.toContain('buildDraftStoryboard')
    expect(storyboard).not.toContain('未绑定资产')
    expect(projectModels).not.toContain("label: '分镜图片'")
    expect(toolbox).toContain("'/api/frameos/generation-config'")
    expect(toolbox).toContain('暂无已配置模型')
    expect(overview).toContain('data-testid="asset-extraction-action"')
    expect(overview).toContain('data-testid="storyboard-generation-action"')
    expect(overview).toContain('data-testid="workflow-progress-card"')
    expect(overview).toContain('预计剩余')
  })

  it('supports large material preview and real asset image edit/import workflows', () => {
    const library = readSource('src/components/frameos/views/FosMaterialLibrary.tsx')
    const assetLibrary = readSource('src/components/frameos/views/FosAssetLibrary.tsx')
    const assets = readSource('src/components/frameos/views/FosAssetSetting.tsx')
    const importRoute = readSource('src/app/api/novel-promotion/[projectId]/import-asset-image/route.ts')
    const modifyWorker = readSource('src/lib/workers/handlers/image-task-handlers-core.ts')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(library).toContain('data-testid="material-large-preview"')
    expect(library).toContain('大图预览 · 按 Esc 关闭')
    expect(library).toContain('export function MaterialUploadDialog')
    expect(assetLibrary).toContain('<MaterialUploadDialog')
    expect(assetLibrary).toContain('initialAssetCategory={uploadCategory}')
    expect(assetLibrary).toContain('lockAssetCategory')
    expect(assetLibrary).toContain('imageOnly')
    expect(assetLibrary).toContain('上传图片')
    expect(assetLibrary).toContain('新增资产')
    expect(assets).toContain('data-testid="asset-image-empty-state"')
    expect(assets).toContain("kind === 'characters' ? '形象设定图'")
    expect(assets).toContain('{mediaName}还未生成')
    expect(assets).toContain('自动作为 Reference 1')
    expect(assets).toContain('<MaterialPickerDialog')
    expect(assets).toContain("assetCategory={tab === 'characters' ? 'character' : tab === 'items' ? 'prop' : 'location'}")
    expect(assets).toContain('/import-asset-image')
    expect(importRoute).toContain("type: 'image'")
    expect(importRoute).toContain('resolveMediaRefFromLegacyValue')
    expect(importRoute).toContain('refreshProjectPanelReferenceAssets')
    expect(modifyWorker).toContain('const referenceImages = Array.from(new Set([requiredReference, ...normalizedExtras]))')
    expect(styles).toContain('select.fos-input { color-scheme: dark; }')
    expect(styles).toContain('select.fos-input option { color: #f2f5ff; background: #17191f; }')
  })

  it('reflows asset and material controls instead of clipping them on narrow screens', () => {
    const materialLibrary = readSource('src/components/frameos/views/FosMaterialLibrary.tsx')
    const assetLibrary = readSource('src/components/frameos/views/FosAssetLibrary.tsx')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(materialLibrary).toContain('className="fml-layout')
    expect(materialLibrary).toContain('className="fml-header-actions')
    expect(materialLibrary).toContain('className="fml-tabs')
    expect(materialLibrary).toContain('className="fml-filters')
    expect(assetLibrary).toContain('className="fal-layout')
    expect(assetLibrary).toContain('className="fal-toolbar-actions')
    expect(styles).toMatch(/@media \(max-width: 1180px\) \{[\s\S]*?\.fal-layout \{[^}]*flex-direction: column;/)
    expect(styles).toMatch(/@media \(max-width: 1180px\) \{[\s\S]*?\.fml-layout \{[^}]*flex-direction: column;/)
    expect(styles).toContain('.fml-tabs { flex-wrap: wrap;')
    expect(styles).toContain('.fml-grid { grid-template-columns: repeat(2,minmax(0,1fr)) !important; }')
  })

  it('keeps image-less assets on a dark actionable empty state instead of a fake preview', () => {
    const assets = readSource('src/components/frameos/views/FosAssetSetting.tsx')
    const emptyStateStart = assets.indexOf('data-testid="asset-image-empty-state"')
    const emptyStateEnd = assets.indexOf('</div>', emptyStateStart)

    expect(emptyStateStart).toBeGreaterThan(-1)
    expect(emptyStateEnd).toBeGreaterThan(emptyStateStart)
    const emptyState = assets.slice(Math.max(0, emptyStateStart - 240), emptyStateEnd + 6)
    expect(emptyState).toContain('bg-[#050506]')
    expect(emptyState).toContain('{mediaName}还未生成')
    expect(emptyState).toContain('可生成图片，或从素材库与本地导入')
    expect(emptyState).not.toContain('<MediaImage')
  })

  it('forces native model options to use readable dark colors, including disabled options', () => {
    const styles = readSource('src/styles/frameos-replica.css')

    expect(styles).toContain('select.fos-input { color-scheme: dark; }')
    expect(styles).toContain('select.fos-input option { color: #f2f5ff; background: #17191f; }')
    expect(styles).toContain('select.fos-input option:disabled { color: #71798a; }')
  })
})
