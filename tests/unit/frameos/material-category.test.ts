import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  frameosAssetCategoryFromMetadata,
  frameosCharacterBindingFromMetadata,
  normalizeFrameosAssetCategory,
  withFrameosAssetCategory,
  withFrameosCharacterBinding,
} from '@/lib/frameos/material-category'

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('FrameOS project material categories', () => {
  it('keeps explicit categories and safely normalizes unknown values', () => {
    expect(normalizeFrameosAssetCategory('character')).toBe('character')
    expect(normalizeFrameosAssetCategory('location')).toBe('location')
    expect(normalizeFrameosAssetCategory('not-real')).toBe('other')
    expect(withFrameosAssetCategory({ prompt: '雨夜' }, 'prop')).toEqual({
      prompt: '雨夜',
      assetCategory: 'prop',
    })
  })

  it('derives categories for existing structured project assets', () => {
    expect(frameosAssetCategoryFromMetadata({ originType: 'character' })).toBe('character')
    expect(frameosAssetCategoryFromMetadata({ originType: 'global-prop' })).toBe('prop')
    expect(frameosAssetCategoryFromMetadata({ originType: 'location' })).toBe('location')
    expect(frameosAssetCategoryFromMetadata({ originType: 'panel' })).toBe('shot')
  })

  it('stores and removes a concrete project character binding without losing metadata', () => {
    const bound = withFrameosCharacterBinding(
      { prompt: '雨夜角色', assetCategory: 'character' },
      { characterId: 'character-1', characterName: '苏晚卿' },
    )
    expect(frameosCharacterBindingFromMetadata(bound)).toEqual({
      characterId: 'character-1',
      characterName: '苏晚卿',
    })
    expect(withFrameosCharacterBinding(bound, null)).toEqual({
      prompt: '雨夜角色',
      assetCategory: 'character',
    })
  })

  it('persists toolbox classification through task payloads into generated materials', () => {
    const route = source('src/app/api/frameos/toolbox/generate/route.ts')
    const imageWorker = source('src/lib/workers/handlers/toolbox-image-task-handler.ts')
    const videoWorker = source('src/lib/workers/handlers/toolbox-video-task-handler.ts')

    expect(route).toContain('assetCategory,')
    expect(route).toContain('normalizeFrameosAssetCategory(body.assetCategory)')
    expect(imageWorker).toContain('assetCategory: normalizeFrameosAssetCategory(payload.assetCategory)')
    expect(videoWorker).toContain('assetCategory: normalizeFrameosAssetCategory(payload.assetCategory)')
  })

  it('exposes the same classification in toolbox, material library, asset library and canvas', () => {
    const toolbox = source('src/components/frameos/views/FosToolbox.tsx')
    const materials = source('src/components/frameos/views/FosMaterialLibrary.tsx')
    const assets = source('src/components/frameos/views/FosAssetLibrary.tsx')
    const canvas = source('src/features/canvas/components/CanvasProjectAssets.tsx')

    expect(toolbox).toContain('归入资产库')
    expect(materials).toContain('资产归类')
    expect(assets).toContain('mapClassifiedMaterial')
    expect(assets).toContain('上传图片')
    expect(assets).toContain('新增资产')
    expect(assets).toContain('initialAssetCategory={uploadCategory}')
    expect(canvas).toContain('aria-label="资产归类"')
    expect(materials).toContain('绑定项目角色')
    expect(materials).toContain('同一角色的图片与音频会在资产库聚合显示')
    expect(assets).toContain('mergeBoundCharacterMaterials')
    expect(canvas).toContain('updateMaterialCategory')
  })
})
