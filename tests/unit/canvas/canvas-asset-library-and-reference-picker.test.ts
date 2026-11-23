import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CanvasContextMenu } from '@/features/canvas/components/CanvasMenus'
import {
  estimateTtsSeconds,
  quoteInputVideoSeconds,
  resolveReferencePickerMax,
} from '@/features/canvas/components/CanvasGenerator'

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
    expect(menu).toContain('归类后可复用于画布与其他作品')
  })

  it('文本节点菜单提供视频统一前置提示词的设置与取消，非文本节点和只读不显示', () => {
    const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(CanvasContextMenu, {
      state: { scope: 'node', nodeId: 'node-1', x: 0, y: 0 },
      canPaste: false,
      canRegenerate: false,
      readOnly: false,
      onAction: vi.fn(),
      ...props,
    }))
    const setMenu = render({ nodeMediaType: 'text' })
    expect(setMenu).toContain('设为视频统一前置提示词')
    expect(setMenu).toContain('置于所有视频提示词最前面')
    expect(setMenu).not.toContain('取消视频统一前置提示词')
    const clearMenu = render({ nodeMediaType: 'text', isVideoPrefixPrompt: true })
    expect(clearMenu).toContain('取消视频统一前置提示词')
    expect(clearMenu).not.toContain('设为视频统一前置提示词')
    expect(render({ nodeMediaType: 'image' })).not.toContain('视频统一前置提示词')
    expect(render({ nodeMediaType: 'text', readOnly: true })).not.toContain('视频统一前置提示词')
  })

  it('视频前置提示词只在视频生成器展示，提交前置于提示词并与全局风格互斥于同一节点', () => {
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    const generator = source('src/features/canvas/components/CanvasGenerator.tsx')
    expect(generator).toContain("type === 'video' && videoPrefixNodeId")
    expect(generator).toContain('aria-label="视频统一前置提示词"')
    expect(generator.indexOf('nori-canvas-global-style is-video-prefix')).toBeLessThan(generator.indexOf('<div className="nori-canvas-generator-prompt">'))
    expect(graph).toContain("composeCanvasVideoPrefixPrompt(styledPrompt, readCanvasVideoPrefixPrompt(nodesRef.current))")
    expect(graph.indexOf("composeCanvasVideoPrefixPrompt(styledPrompt")).toBeGreaterThan(graph.indexOf('const styledPrompt = '))
    expect(graph).toContain('videoPrefixNodeId={videoPrefixNode?.id}')
    expect(graph).toContain('isVideoPrefixPrompt={contextNode?.data.videoPrefixPrompt === true}')
    const clone = source('src/features/canvas/clone-node-data.ts')
    expect(clone).toContain('videoPrefixPrompt: false')
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
    expect(generator).toContain('title="添加引用素材（无需连线）"')
    expect(generator).toContain('aria-haspopup="menu"')
    expect(generator).toContain('<span>从素材库选择</span>')
    expect(generator).toContain('onAddReferences({ type: referencePickerType, maxSelected: referencePickerMax })')
    expect(generator).toContain('export function resolveReferencePickerMax(')
    expect(generator).toContain("? inputMode === 'text' ? 'all' : 'image'")
    expect(generator).toContain('const injectedSignature = (injectedReferenceNodeIds || []).join(\'|\')')
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain("if (node.id !== picker.nodeId) return node.selected ? { ...node, selected: false } : node")
    expect(graph).toContain('...(node.data.generation?.referenceNodeIds || []), ...createdIds')
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

  it('每个引用素材都有独立移除按钮：已连线的同时删除连线，未连线的只移出引用', () => {
    const generator = source('src/features/canvas/components/CanvasGenerator.tsx')
    expect(generator).toContain('nori-canvas-generator-ref-remove')
    expect(generator).toContain('onRemoveReference?: (sourceNodeId: string) => void')
    expect(generator).toContain('if (onRemoveReference && wiredReferenceIds.has(reference.id))')
    expect(generator).toContain('点击本次不引用（连线保留）')
    // The remove control is a sibling of the toggle tile: nested buttons are invalid HTML.
    const thumbStart = generator.indexOf('function ReferenceThumb(')
    const thumb = generator.slice(thumbStart, generator.indexOf('export function CanvasGenerator('))
    // Tile toggle + voice toggle (bound characters only) + remove button, all siblings.
    expect(thumb.match(/<button/g)?.length).toBe(3)
    expect(thumb).toContain('nori-canvas-generator-ref-item')
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('const removeReferenceWire = useCallback((targetNodeId: string, sourceNodeId: string) => {')
    expect(graph).toContain('onRemoveReference={(sourceNodeId) => removeReferenceWire(selectedCreativeNode.id, sourceNodeId)}')
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
    expect(graph).toContain('const createdIds = insertMaterials(validMaterials.map')
    expect(graph).toContain('setGeneratorReferenceInjection({ nodeId: picker.nodeId, ids: createdIds })')
    expect(graph).toContain('allowAllTypes multiple maxSelected={generatorReferencePicker.maxSelected}')
    expect(graph).toContain('injectedReferenceNodeIds={generatorReferenceInjection.nodeId === selectedCreativeNode.id')
    expect(graph).toContain('EMPTY_REFERENCE_NODE_IDS')
  })

  it('配置加载完成前不把已保存的图生视频/首尾帧模式降级为全能参考', () => {
    const generator = source('src/features/canvas/components/CanvasGenerator.tsx')
    expect(generator).toContain('if (currentModel) {')
    expect(generator).toContain("if (!supportsImageToVideo && inputMode === 'image') setInputMode((current) => current === 'image' ? 'text' : current)")
    expect(generator).toContain("if (currentModel.raw?.firstLastFrame !== true && inputMode === 'firstlastframe') setInputMode((current) => current === 'firstlastframe' ? 'text' : current)")
    // 旧写法在 currentModel 尚未解析时也会判定为“不支持”，会把保存的首尾帧模式冲掉。
    expect(generator).not.toContain("!currentModel?.raw?.firstLastFrame && inputMode === 'firstlastframe'")
  })
})

describe('生成积分报价输入估算', () => {
  it('多个参考视频按时长求和，而不是取最长一个', () => {
    const node = (id: string, metadata: unknown) => ({
      id,
      type: 'video',
      data: { mediaType: 'video', sourceMetadata: metadata },
    }) as Parameters<typeof quoteInputVideoSeconds>[1][number]

    expect(quoteInputVideoSeconds(['a', 'b', 'c'], [
      node('a', { durationSeconds: 3 }),
      node('b', { duration: 4.5 }),
      node('c', { durationMs: 1500 }),
      node('d', { durationSeconds: 99 }),
    ])).toBe(9)
  })

  it('TTS 按中英文字数给出保守预估而不是固定 1 秒', () => {
    expect(estimateTtsSeconds('')).toBe(1)
    expect(estimateTtsSeconds('你好，世界。')).toBeGreaterThan(1)
    expect(estimateTtsSeconds('Hello beautiful world')).toBeGreaterThan(1)
  })
})
