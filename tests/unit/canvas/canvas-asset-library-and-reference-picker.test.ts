import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CanvasContextMenu } from '@/features/canvas/components/CanvasMenus'
import { resolveReferencePickerMax } from '@/features/canvas/components/CanvasGenerator'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

describe('画布素材上传资产库入口', () => {
  it('在可写节点菜单里提供上传资产库，并带上归类提示', () => {
    const menu = renderToStaticMarkup(React.createElement(CanvasContextMenu, {
      state: { scope: 'node', nodeId: 'node-1', x: 0, y: 0 },
      canPaste: false,
      canRegenerate: true,
      canUploadToAssetLibrary: true,
      readOnly: false,
      onAction: vi.fn(),
    }))
    expect(menu).toContain('上传到资产库')
    expect(menu).toContain('归类后可复用于画布与其他项目')
  })

  it('只读或不可上传的节点不显示该入口', () => {
    const writableWithoutImage = renderToStaticMarkup(React.createElement(CanvasContextMenu, {
      state: { scope: 'node', nodeId: 'node-1', x: 0, y: 0 },
      canPaste: false,
      canRegenerate: false,
      canUploadToAssetLibrary: false,
      readOnly: false,
      onAction: vi.fn(),
    }))
    expect(writableWithoutImage).not.toContain('上传到资产库')

    const readOnly = renderToStaticMarkup(React.createElement(CanvasContextMenu, {
      state: { scope: 'node', nodeId: 'node-1', x: 0, y: 0 },
      canPaste: false,
      canRegenerate: true,
      canUploadToAssetLibrary: true,
      readOnly: true,
      onAction: vi.fn(),
    }))
    expect(readOnly).not.toContain('上传到资产库')
  })

  it('画布接线只在图片节点、非只读且存在图片地址时开放上传', () => {
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('const canUploadToAssetLibrary = Boolean(')
    expect(graph).toContain("getMediaType(contextNode) === 'image'")
    expect(graph).toContain("if (action === 'upload-asset-library') setAssetLibraryNodeId(menu.nodeId)")
    expect(graph).toContain("register: 'library'")
    expect(graph).toContain('<CanvasAssetLibraryDialog')
  })

  it('上传对话框限定资产库可展示的三类归类', () => {
    const dialog = source('src/features/canvas/components/CanvasAssetLibraryDialog.tsx')
    expect(dialog).toContain("const LIBRARY_CATEGORIES: FrameosAssetCategory[] = ['character', 'location', 'prop']")
    expect(dialog).toContain('上传到资产库')
    expect(dialog).toContain('FRAMEOS_ASSET_CATEGORY_LABELS[category]')
  })
})

describe('生成节点引用素材加号', () => {
  it('引用素材行始终渲染素材库加号，并按模式选择素材类型', () => {
    const generator = source('src/features/canvas/components/CanvasGenerator.tsx')
    expect(generator).toContain('nori-canvas-generator-ref-add')
    expect(generator).toContain("title=\"从素材库添加引用素材（无需连线）\"")
    expect(generator).toContain('onAddReferences({ type: referencePickerType, maxSelected: referencePickerMax })')
    expect(generator).toContain('export function resolveReferencePickerMax(')
    expect(generator).toContain("? inputMode === 'text' ? 'all' : 'image'")
    expect(generator).toContain('const injectedSignature = (injectedReferenceNodeIds || []).join(\'|\')')
    expect(generator).toContain('if (!next.includes(id)) next.push(id)')
  })

  it('加号位于引用素材行，不再是只有已有引用才显示', () => {
    const generator = source('src/features/canvas/components/CanvasGenerator.tsx')
    const rowStart = generator.indexOf('<div className="nori-canvas-generator-refs">')
    expect(rowStart).toBeGreaterThan(-1)
    const row = generator.slice(rowStart, generator.indexOf('</div>', generator.indexOf('nori-canvas-generator-ref-add')))
    expect(row).toContain('引用素材')
    expect(row).toContain('nori-canvas-generator-ref-add')
    expect(generator).toContain("{type === 'image' || type === 'video' || type === 'audio' ? (")
  })

  it('按模式取引用上限，全能参考累加多模态上限', () => {
    const maxes = { image: 9, video: 3, audio: 3 }
    expect(resolveReferencePickerMax('image', maxes)).toBe(9)
    expect(resolveReferencePickerMax('video', maxes)).toBe(3)
    expect(resolveReferencePickerMax('audio', maxes)).toBe(3)
    expect(resolveReferencePickerMax('all', maxes)).toBe(15)
    expect(resolveReferencePickerMax(null, maxes)).toBe(9)
    expect(resolveReferencePickerMax('all', { image: 0, video: 0, audio: 0 })).toBe(9)
  })

  it('素材库选择后插入画布并注入为引用，不依赖连线', () => {
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('const addGeneratorReferenceMaterials = useCallback(')
    expect(graph).toContain('const created = insertMaterial(material, { x: anchor.x, y: anchor.y + index * 280 })')
    expect(graph).toContain('setGeneratorReferenceInjection({ nodeId: picker.nodeId, ids: createdIds })')
    expect(graph).toContain('allowAllTypes multiple maxSelected={generatorReferencePicker.maxSelected}')
    expect(graph).toContain('injectedReferenceNodeIds={generatorReferenceInjection.nodeId === selectedCreativeNode.id')
    expect(graph).toContain('EMPTY_REFERENCE_NODE_IDS')
  })

  it('配置加载完成前不把已保存的图生视频/首尾帧模式降级为全能参考', () => {
    const generator = source('src/features/canvas/components/CanvasGenerator.tsx')
    expect(generator).toContain('if (currentModel) {')
    expect(generator).toContain("if (!supportsImageToVideo && inputMode === 'image') setInputMode('text')")
    expect(generator).toContain("if (currentModel.raw?.firstLastFrame !== true && inputMode === 'firstlastframe') setInputMode('text')")
    // 旧写法在 currentModel 尚未解析时也会判定为“不支持”，会把保存的首尾帧模式冲掉。
    expect(generator).not.toContain("!currentModel?.raw?.firstLastFrame && inputMode === 'firstlastframe'")
  })
})
