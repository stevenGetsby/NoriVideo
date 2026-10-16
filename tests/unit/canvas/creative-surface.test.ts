import fs from 'node:fs'
import path from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MaterialPickerDialog } from '@/components/frameos/materials/MaterialPickerDialog'
import { CanvasAddPanel } from '@/features/canvas/components/CanvasToolRail'
import {
  CANVAS_ADD_NODE_ITEMS,
  defaultCanvasNodeData,
} from '@/features/canvas/editor-types'
import { CANVAS_NODE_TYPE_AUDIO } from '@/features/canvas/types'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin', permissions: ['assetWrite'] } }, status: 'authenticated' }),
}))

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function enabledButtonContaining(markup: string, labelMarker: string): string {
  const labelIndex = markup.indexOf(labelMarker)
  expect(labelIndex).toBeGreaterThan(-1)
  const start = markup.lastIndexOf('<button', labelIndex)
  const end = markup.indexOf('</button>', labelIndex)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(labelIndex)
  const button = markup.slice(start, end + '</button>'.length)
  expect(button).not.toContain('disabled')
  return button
}

describe('infinite canvas creative surface parity', () => {
  it('keeps audio upload-backed while preserving the full audio node data contract', () => {
    expect(CANVAS_ADD_NODE_ITEMS.some((item) => item.type === CANVAS_NODE_TYPE_AUDIO)).toBe(false)
    expect(defaultCanvasNodeData(CANVAS_NODE_TYPE_AUDIO)).toEqual({
      title: '音频节点',
      mediaType: 'audio',
      origin: 'empty',
      prompt: '',
    })

    const addPanel = renderToStaticMarkup(React.createElement(CanvasAddPanel, {
      onAddNode: vi.fn(),
      onUpload: vi.fn(),
    }))
    const labelIndex = addPanel.indexOf('>音频<small')
    const buttonStart = addPanel.lastIndexOf('<button', labelIndex)
    const buttonEnd = addPanel.indexOf('</button>', labelIndex)
    const audioButton = addPanel.slice(buttonStart, buttonEnd)
    expect(audioButton).toContain('disabled')
    expect(audioButton).toContain('请通过上传文件添加')
  })

  it('uses the all-type material picker and the shared insertion path', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const pickerStart = graph.indexOf('<MaterialPickerDialog projectId={projectId}')
    const pickerEnd = graph.indexOf('/> : null}', pickerStart)
    expect(pickerStart).toBeGreaterThan(-1)
    expect(pickerEnd).toBeGreaterThan(pickerStart)
    const pickerInvocation = graph.slice(pickerStart, pickerEnd)

    expect(pickerInvocation).toContain('allowAllTypes')
    expect(pickerInvocation).toMatch(/\bmultiple\b/)
    expect(pickerInvocation).toContain('onConfirm={(materials)')
    expect(pickerInvocation).toContain('insertMaterials(materials.map((material, index)')
    expect(pickerInvocation).toContain('setPickerOpen(false)')

    const picker = renderToStaticMarkup(React.createElement(MaterialPickerDialog, {
      projectId: 'project-1',
      allowAllTypes: true,
      multiple: true,
      confirmLabel: '添加到画布',
      onConfirm: vi.fn(),
      onClose: vi.fn(),
    }))
    for (const label of ['全部', '图片', '视频', '音频', '3D']) {
      expect(enabledButtonContaining(picker, `>${label}</button>`)).toContain(label)
    }
    expect(picker).toContain('>添加到画布</button>')
  })

  it('exposes in-place replacement for every editable media node, including empty nodes', () => {
    const creativeNode = readSource('src/features/canvas/nodes/CreativeNode.tsx')
    const generator = readSource('src/features/canvas/components/CanvasGenerator.tsx')
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')

    expect(creativeNode).toContain("['image', 'video', 'audio', 'model3d'].includes(mediaType)")
    expect(creativeNode).toContain('actions.length > 0 || canReplaceContent')
    expect(creativeNode).toContain('aria-label="替换内容"')
    expect(creativeNode).toContain('CANVAS_REPLACE_CONTENT_EVENT')
    expect(generator).toContain('title="替换当前节点内容"')
    expect(generator).toContain('onReplace: () => void')
    expect(graph).toContain('onReplace={() => requestContentReplacement(selectedCreativeNode.id)}')
    expect(graph).toContain('ref={replacementUploadRef}')
  })

  it('keeps nodes freely resizable and provides an explicit non-destructive return from the large editor', () => {
    const creativeNode = readSource('src/features/canvas/nodes/CreativeNode.tsx')
    const generator = readSource('src/features/canvas/components/CanvasGenerator.tsx')

    expect(creativeNode).toContain('keepAspectRatio={false}')
    expect(creativeNode).toContain('nori-canvas-node-toolbar-menu')
    expect(generator).toContain('返回画布')
    expect(generator).toContain("data-editor-mode={fullscreen ? 'expanded' : 'anchored'}")
    expect(generator).toContain('minHeight={fullscreen ? 280 : 150}')
  })

  it('keeps the node editor stationary, bounded below chrome, and dismissible without moving its node', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const generator = readSource('src/features/canvas/components/CanvasGenerator.tsx')
    const styles = readSource('src/features/canvas/canvas.css')

    expect(graph).toContain('const selectedCreativeNode = directlySelectedCreativeNode')
    expect(graph).not.toContain('generatorPointer')
    expect(graph).not.toContain('generatorNodeId')
    expect(graph).toContain('onClose={() => setNodes((current) => current.map((node) => node.id === selectedCreativeNode.id ? { ...node, selected: false } : node))}')
    expect(generator).toContain('className="nori-canvas-generator-scroll"')
    expect(generator).toContain('maxHeight: `${anchor.maxHeight}px`')
    expect(styles).toContain('.nori-canvas-generator.is-node-anchored .nori-canvas-generator-head')
    expect(styles).toContain('top: var(--canvas-chrome-safe-top, 116px);')
  })

  it('persists previewable @ references on video nodes', () => {
    const creativeNode = readSource('src/features/canvas/nodes/CreativeNode.tsx')
    const generator = readSource('src/features/canvas/components/CanvasGenerator.tsx')

    expect(generator).toContain('previewUrl: node.data.contentUrl')
    expect(creativeNode).toContain('nori-canvas-reference-strip')
    expect(creativeNode).toContain('@{reference.title}')
    expect(creativeNode).toContain('aria-label={`放大预览 @${reference.title}`}')
    expect(creativeNode).toContain('<CanvasMediaPreviewDialog node={previewReferenceNode}')
    expect(creativeNode).toContain('createPortal(')
  })

  it('exposes the real FrameOS 3D generation controls and durable toolbox path', () => {
    const generator = readSource('src/features/canvas/components/CanvasGenerator.tsx')
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const generationConfig = readSource('src/app/api/frameos/generation-config/route.ts')
    const toolboxRoute = readSource('src/app/api/frameos/toolbox/generate/route.ts')

    for (const marker of ['帧界 3D 1.0', '标准', '低模', '生成贴图', 'A 姿势', 'T 姿势']) {
      expect(generator).toContain(marker)
    }
    expect(generator).toContain("if (type === 'model3d') return (config?.model3dModels || [])")
    expect(graph).toContain("request.type !== 'model3d'")
    expect(graph).toContain("asset.type === 'model3d'")
    expect(generationConfig).toContain('const model3dAvailability = getFrameos3DModelAvailability()')
    expect(generationConfig).toContain('model3dModels: [{')
    expect(generationConfig).toContain('...model3dAvailability,')
    expect(toolboxRoute).toContain('TASK_TYPE.TOOLBOX_MODEL_3D')
    expect(toolboxRoute).toContain('bindModel3DTaskToCanvasNode')
  })

  it('matches the FrameOS image/video generator surface and persists every selected option', () => {
    const generator = readSource('src/features/canvas/components/CanvasGenerator.tsx')
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const worker = readSource('src/lib/workers/handlers/toolbox-image-task-handler.ts')
    const toolbox = readSource('src/components/frameos/views/FosToolbox.tsx')

    expect(generator).toContain('CANVAS_IMAGE_ASPECT_RATIOS')
    expect(generator).toContain('CANVAS_IMAGE_RESOLUTIONS')
    expect(generator).toContain('CANVAS_IMAGE_QUALITIES')
    expect(generator).toContain('canvasVideoAspectRatioOptions')
    expect(generator).toContain('CANVAS_VIDEO_RESOLUTIONS')
    expect(generator).toContain('>全能参考</option>')
    expect(generator).toContain('>图生视频</option>')
    expect(generator).toContain('>首尾帧</option>')
    expect(generator).toContain('<span>生成声音</span>')
    expect(generator).toContain('nori-canvas-generator-sound')
    expect(generator).toContain('node.data.generation?.generateAudio ?? true')
    expect(generator).toContain('<span>视频帧率</span>')
    expect(generator).toContain('nori-canvas-generator-parameter-grid')
    expect(generator).toContain('isPanorama ? [CANVAS_PANORAMA_ASPECT_RATIO]')
    expect(generator).toContain('21:9 超宽幅全景图')
    expect(generator).not.toContain('2:1 等距柱状投影全景图')
    expect(graph).toContain('quality: request.quality')
    expect(graph).toContain('fps: request.fps')
    expect(worker).toContain("readString(payload.quality)")
    expect(toolbox).toContain('CANVAS_IMAGE_ASPECT_RATIOS')
    expect(toolbox).toContain('canvasVideoAspectRatioOptions')
    expect(toolbox).toContain('CANVAS_IMAGE_QUALITIES')
    expect(toolbox).toContain('options.quality = quality')
    expect(toolbox).toContain('options.fps = fps')
  })

  it('keeps mask editing separate from ordinary references and disables unsupported models', () => {
    const generator = readSource('src/features/canvas/components/CanvasGenerator.tsx')
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const configRoute = readSource('src/app/api/frameos/generation-config/route.ts')

    expect(configRoute).toContain('supportsInpaint:')
    expect(generator).toContain("model.raw?.supportsInpaint === true")
    expect(generator).toContain('当前模型不支持蒙版重绘')
    expect(generator).toContain('imageEditModelUnavailable')
    expect(graph).toContain("processType === 'image_edit' ? { maskMaterialId } : {}")
    expect(graph).toContain("target.data.processType === 'image_edit'")
    expect(graph).toContain('maskMaterialId has dedicated inpaint semantics')
    expect(graph).not.toContain('const values = [parameters?.maskMaterialId, parameters?.referenceMaterialId]')
  })
})
