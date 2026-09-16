import fs from 'node:fs'
import path from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CanvasHistoryDialog, canvasHistorySourceLabel } from '@/features/canvas/components/CanvasDialogs'
import {
  isCanvasMaskActionDrawable,
  normalizeCanvasMaskRectangle,
  renderCanvasMaskActions,
  type CanvasMaskAction,
} from '@/features/canvas/components/CanvasImageEditDialog'
import {
  canvasReplacementAccept,
  isMatchingCanvasReplacementFile,
  normalizeCanvasConnection,
  replaceCanvasNodeContent,
  shouldBlockCanvasShortcutWhileLocked,
  type CanvasFlowNode,
} from '@/features/canvas/editor-types'
import {
  canvasHistoryHasRestorableValue,
  isCanvasHistoryItemCurrent,
  prependCanvasGenerationHistory,
  removeDisconnectedCanvasReferences,
  resolveCanvasModel3DRegenerationOptions,
  resolveCanvasRegenerationMode,
  type CanvasGenerationHistoryItem,
} from '@/features/canvas/types'

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function buttonContaining(markup: string, label: string) {
  const labelIndex = markup.indexOf(label)
  expect(labelIndex).toBeGreaterThan(-1)
  const start = markup.lastIndexOf('<button', labelIndex)
  const end = markup.indexOf('</button>', labelIndex)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(labelIndex)
  return markup.slice(start, end + '</button>'.length)
}

describe('canvas editor interaction contracts', () => {
  it('clears selected nodes and edges when the canvas pane is clicked', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const pointerUpStart = graph.indexOf('onPointerUpCapture={(event) => {')
    const pointerUpEnd = graph.indexOf('onPointerCancelCapture=', pointerUpStart)
    const pointerUp = graph.slice(pointerUpStart, pointerUpEnd)
    const paneClickStart = graph.indexOf('onPaneClick={() => {')
    const paneClickEnd = graph.indexOf('onPaneContextMenu=', paneClickStart)
    const paneClick = graph.slice(paneClickStart, paneClickEnd)

    expect(graph).toContain('const clearCanvasSelection = useCallback(() => {')
    expect(graph).toContain('function isCanvasBlankPointerTarget(target: EventTarget | null)')
    expect(graph).toContain("target.closest('.react-flow__background')")
    expect(graph).toContain('&& isCanvasBlankPointerTarget(event.target)')
    expect(graph).toContain('node.selected ? { ...node, selected: false } : node')
    expect(graph).toContain('edge.selected ? { ...edge, selected: false } : edge')
    expect(pointerUp).toContain('} else if (!edgeSelection.additive) {')
    expect(pointerUp).toContain('clearCanvasSelection()')
    expect(paneClick).toContain('clearCanvasSelection()')
  })

  it('matches FrameOS bidirectional side-port wiring and canonical edge direction', () => {
    expect(normalizeCanvasConnection({ source: 'upstream', target: 'downstream', sourceHandle: 'output', targetHandle: 'input' })).toEqual({
      source: 'upstream', target: 'downstream', sourceHandle: 'output', targetHandle: 'input',
    })
    expect(normalizeCanvasConnection({ source: 'downstream', target: 'upstream', sourceHandle: 'input', targetHandle: 'output' })).toEqual({
      source: 'upstream', target: 'downstream', sourceHandle: 'output', targetHandle: 'input',
    })
    expect(normalizeCanvasConnection({ source: 'a', target: 'b', sourceHandle: 'input', targetHandle: 'input' })).toBeNull()
    expect(normalizeCanvasConnection({ source: 'a', target: 'b', sourceHandle: 'output', targetHandle: 'output' })).toBeNull()

    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const creativeNode = readSource('src/features/canvas/nodes/CreativeNode.tsx')
    expect(graph).toContain('connectionMode={ConnectionMode.Loose}')
    expect(graph).toContain('connectOnClick={false}')
    expect(graph).toContain('selectionMode={SelectionMode.Partial}')
    expect(graph).toContain("multiSelectionKeyCode={['Shift', 'Meta', 'Control']}")
    expect(graph).toContain('minZoom={0.15}')
    expect(graph).toContain('maxZoom={5}')
    expect(creativeNode).toContain('<Handle type="source" position={Position.Left} id="input"')
    expect(creativeNode).toContain('<Handle type="source" position={Position.Right} id="output"')
  })

  it('replaces media in place, retains history, and clears stale generation references', () => {
    const node: CanvasFlowNode = {
      id: 'image-node',
      type: 'image',
      position: { x: 20, y: 30 },
      data: {
        title: '主视觉',
        mediaType: 'image',
        origin: 'generate',
        contentUrl: 'https://assets.test/old.png',
        imageUrl: 'https://assets.test/old.png',
        materialId: 'material-old',
        processType: 'storyboard',
        storyboardIndex: 2,
        generation: {
          modelKey: 'image-model',
          assetId: 'asset-running',
          taskId: 'task-running',
          referenceNodeIds: ['reference-1'],
          parameters: { maskMaterialId: 'mask-old', strength: 0.8 },
        },
        history: [{ id: 'history-1', url: 'https://assets.test/older.png', status: 'ready', createdAt: '2026-07-16T00:00:00.000Z' }],
        __server: { status: 'RUNNING', taskId: 'task-running', runId: 'run-1', mediaObjectId: 'media-1', parentNodeId: null },
      },
    }
    let sequence = 0
    const replaced = replaceCanvasNodeContent(node, {
      id: 'material-new',
      type: 'image',
      url: 'https://assets.test/new.png',
    }, {
      createId: () => `replacement-${++sequence}`,
      createdAt: '2026-07-17T00:00:00.000Z',
    })

    expect(replaced.id).toBe(node.id)
    expect(replaced.type).toBe(node.type)
    expect(replaced.data).toMatchObject({
      origin: 'upload',
      contentUrl: 'https://assets.test/new.png',
      imageUrl: 'https://assets.test/new.png',
      materialId: 'material-new',
      processType: undefined,
      storyboardIndex: undefined,
      progress: 100,
      __server: { status: 'SUCCEEDED', taskId: null, runId: null, mediaObjectId: null },
    })
    expect(replaced.data.history?.map((item) => item.url)).toEqual([
      'https://assets.test/new.png',
      'https://assets.test/old.png',
      'https://assets.test/older.png',
    ])
    expect(replaced.data.history?.slice(0, 2).map((item) => item.source)).toEqual(['upload', 'canvas'])
    expect(replaced.data.generation).toMatchObject({
      modelKey: 'image-model',
      referenceNodeIds: [],
      parameters: { strength: 0.8 },
    })
    expect(replaced.data.generation?.assetId).toBeUndefined()
    expect(replaced.data.generation?.taskId).toBeUndefined()

    expect(canvasReplacementAccept('model3d')).toContain('.glb')
    expect(canvasReplacementAccept('model3d')).not.toContain('.gltf')
    expect(isMatchingCanvasReplacementFile('model3d', { name: 'model.glb', type: 'model/gltf-binary' })).toBe(true)
    expect(isMatchingCanvasReplacementFile('model3d', { name: 'model.gltf', type: 'model/gltf+json' })).toBe(false)
    expect(isMatchingCanvasReplacementFile('image', { name: 'new.png', type: 'image/png' })).toBe(true)
    expect(isMatchingCanvasReplacementFile('image', { name: 'wrong.mp4', type: 'video/mp4' })).toBe(false)
    expect(() => replaceCanvasNodeContent(node, { id: 'wrong', type: 'video', url: 'https://assets.test/wrong.mp4' })).toThrow('类型与节点不一致')

    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const replacementStart = graph.indexOf('const handleContentReplacement = useCallback')
    const replacementEnd = graph.indexOf('const handleUploads = useCallback', replacementStart)
    const implementation = graph.slice(replacementStart, replacementEnd)
    expect(implementation).toContain('replaceCanvasNodeContent(current')
    expect(implementation).toContain('edgesRef.current.filter((edge) => edge.target === nodeId)')
    expect(implementation).toContain('edgesRef.current.filter((edge) => edge.target !== nodeId)')
    expect(graph).toContain('CANVAS_REPLACE_CONTENT_EVENT')
  })

  it('bounds generation history by count and UTF-8 storage budget', () => {
    const current: CanvasGenerationHistoryItem = {
      id: 'current',
      prompt: '最新提示词',
      status: 'ready',
      createdAt: '2026-07-17T00:00:00.000Z',
    }
    const previous = Array.from({ length: 60 }, (_, index): CanvasGenerationHistoryItem => ({
      id: `old-${index}`,
      prompt: '旧版本',
      status: 'ready',
      createdAt: '2026-07-16T00:00:00.000Z',
    }))
    const bounded = prependCanvasGenerationHistory(current, previous)
    expect(bounded[0]).toBe(current)
    expect(bounded).toHaveLength(40)

    const oversized: CanvasGenerationHistoryItem = {
      ...current,
      id: 'oversized',
      prompt: '界'.repeat(70_000),
    }
    const withoutOversized = prependCanvasGenerationHistory(oversized, [current])
    expect(withoutOversized).toEqual([current])
  })

  it('reruns a storyboard output as exactly one ordinary image', () => {
    expect(resolveCanvasRegenerationMode({
      processType: 'storyboard',
      generation: { count: 6 },
    })).toEqual({ count: 1, storyboard: false })
    expect(resolveCanvasRegenerationMode({
      generation: { count: 3 },
    })).toEqual({ count: 3, storyboard: false })

    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('const regeneration = resolveCanvasRegenerationMode(node.data)')
    expect(graph).toContain('count: regeneration.count, storyboard: regeneration.storyboard')
  })

  it('keeps the selected 3D topology, texture, and pose when regenerating', () => {
    expect(resolveCanvasModel3DRegenerationOptions({
      generation: {
        parameters: {
          topology: 'low_poly',
          generateTexture: false,
          pose: 't_pose',
        },
      },
    })).toEqual({
      model3dTopology: 'low_poly',
      model3dGenerateTexture: false,
      model3dPose: 't_pose',
    })
    expect(resolveCanvasModel3DRegenerationOptions({ generation: null })).toEqual({
      model3dTopology: 'standard',
      model3dGenerateTexture: true,
      model3dPose: 'none',
    })

    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('...resolveCanvasModel3DRegenerationOptions(node.data)')
  })

  it('routes horizontal and vertical selection actions through a selection-only arranger', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const start = graph.indexOf('const organizeSelection = useCallback')
    const end = graph.indexOf('const validateConnection', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const implementation = graph.slice(start, end)

    expect(implementation).toContain("node.selected && node.type !== 'group'")
    expect(implementation).toContain('arrangeCanvasGroupNodes(')
    expect(implementation).toContain('edgesRef.current')
    expect(implementation).toContain('positions.has(node.id)')
    expect(implementation).toContain('fitCanvasGroupsToMembers(moved,')
    expect(graph).toContain("onClick={() => organizeSelection('horizontal')}")
    expect(graph).toContain("onClick={() => organizeSelection('vertical')}")
  })

  it('keeps the group interior marqueeable while retaining explicit compound drag rails', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const group = readSource('src/features/canvas/nodes/GroupNode.tsx')
    const css = readSource('src/features/canvas/canvas.css')

    expect(group.match(/nori-canvas-group-drag-edge/g)).toHaveLength(4)
    expect(group).toContain('nori-canvas-group-drag-handle')
    expect(css).toContain('.react-flow__node-group { pointer-events: none !important; }')
    expect(css).toContain('.react-flow__node-group .nori-canvas-group-drag-edge')
    expect(graph).toContain('arrangeCanvasGroupMembers(current, node.id, mode, edgesRef.current)')
    expect(graph).toContain('fitCanvasGroupsToMembers(moved,')
  })

  it('matches FrameOS keyboard redo and selected-node nudge behavior', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const help = readSource('src/features/canvas/components/CanvasHelpPanel.tsx')

    expect(graph).toContain("event.key.toLowerCase() === 'y'")
    expect(graph).toContain("['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)")
    expect(graph).toContain('const distance = event.shiftKey ? 50 : 5')
    expect(graph).toContain('const movedIds = expandGroupNodeIds(requestedIds)')
    expect(graph).toContain('reconcileDraggedNodeGroupMembership(moved, requestedIds)')
    expect(graph).toContain("record('移动选中节点')")
    expect(help).toContain("['移动节点', '方向键 5px']")
    expect(help).toContain("['快速移动', '⇧ + 方向键 50px']")
    expect(help).toContain('${mod} Y')
  })

  it('lets a text node drag from its preview while keeping the active editor interactive', () => {
    const creativeNode = readSource('src/features/canvas/nodes/CreativeNode.tsx')
    expect(creativeNode).toContain('className="nori-canvas-text-preview"')
    expect(creativeNode).not.toContain('className="nodrag nori-canvas-text-preview"')
    expect(creativeNode).toContain('className="nodrag nowheel nori-canvas-text-editor"')
  })

  it('blocks only mutating canvas shortcuts during server reconciliation', () => {
    const shortcut = (
      key: string,
      overrides: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {},
    ) => shouldBlockCanvasShortcutWhileLocked({
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      ...overrides,
    })

    expect(shortcut('Delete')).toBe(true)
    expect(shortcut('ArrowRight')).toBe(true)
    expect(shortcut('z', { metaKey: true })).toBe(true)
    expect(shortcut('v', { ctrlKey: true })).toBe(true)
    expect(shortcut('s', { metaKey: true })).toBe(true)

    expect(shortcut('Tab')).toBe(false)
    expect(shortcut('Escape')).toBe(false)
    expect(shortcut('l', { metaKey: true })).toBe(false)
    expect(shortcut('r', { ctrlKey: true })).toBe(false)
    expect(shortcut('ArrowLeft', { altKey: true })).toBe(false)
    expect(shortcut('c', { metaKey: true })).toBe(false)

    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const keydownStart = graph.indexOf('const keydown = (event: KeyboardEvent) => {')
    const escapeBeforeInput = graph.indexOf("if (event.key === 'Escape') {", keydownStart)
    const inputFocusGuard = graph.indexOf('if (hasInputFocus()) return', keydownStart)
    expect(keydownStart).toBeGreaterThan(-1)
    expect(escapeBeforeInput).toBeGreaterThan(keydownStart)
    expect(inputFocusGuard).toBeGreaterThan(escapeBeforeInput)
    expect(graph).toContain('if (shouldBlockCanvasShortcutWhileLocked(event)) event.preventDefault()')
    expect(graph).toContain('dismissTransientUi()')
    expect(graph).toContain('setAssetsOpen(false)')
    expect(graph).toContain('setPickerOpen(false)')
  })

  it('cancels pending wires and every media preview with Escape', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const preview = readSource('src/features/canvas/components/CanvasMediaPreviewDialog.tsx')

    expect(graph).toContain('flowStore.getState().cancelConnection()')
    expect(graph).toContain('connectionActiveRef.current = false')
    expect(graph).toContain('setConnectionActive(false)')
    expect(graph).toContain('setMediaPreviewNodeId(null)')
    expect(graph).toContain('setModelPreviewNodeId(null)')
    expect(graph).toContain('setPanoramaPreviewNodeId(null)')
    expect(preview).toContain("document.addEventListener('keydown', keydown, true)")
    expect(preview).toContain("document.removeEventListener('keydown', keydown, true)")
    expect(preview).toContain('role="dialog" aria-modal="true"')
  })

  it('removes a disconnected source reference but keeps duplicate and unrelated references', () => {
    const references = ['source-a', 'source-b', 'manual-reference']
    const removed = [
      { source: 'source-a', target: 'target' },
      { source: 'source-b', target: 'target' },
      { source: 'source-a', target: 'other-target' },
    ]
    const remaining = [{ source: 'source-a', target: 'target' }]

    expect(removeDisconnectedCanvasReferences(references, 'target', removed, remaining)).toEqual([
      'source-a',
      'manual-reference',
    ])
    expect(removeDisconnectedCanvasReferences(references, 'unaffected-target', removed, remaining)).toBe(references)

    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('cleanupDisconnectedReferences(removedEdges, remainingEdges)')
    expect(graph).toContain('if (selectedEdgeIds.length > 0) removeEdgesById(selectedEdgeIds)')
    expect(graph).toContain("if (menu.scope === 'edge' && action === 'delete-edge') { removeEdgesById([menu.edgeId]); return }")
  })

  it('previews and restores text history while disabling the current version', () => {
    const currentText = '当前文本版本'
    const current: CanvasGenerationHistoryItem = {
      id: 'current',
      text: currentText,
      status: 'ready',
      createdAt: '2026-07-17T00:00:00.000Z',
    }
    const previous: CanvasGenerationHistoryItem = {
      id: 'previous',
      text: '上一版文本',
      status: 'ready',
      createdAt: '2026-07-16T00:00:00.000Z',
    }
    const node: CanvasFlowNode = {
      id: 'text-node',
      type: 'text',
      position: { x: 0, y: 0 },
      data: {
        title: '文本节点',
        mediaType: 'text',
        text: currentText,
        history: [current, previous],
      },
    }

    expect(canvasHistoryHasRestorableValue(current, 'text')).toBe(true)
    expect(isCanvasHistoryItemCurrent(current, node.data, 'text')).toBe(true)
    expect(isCanvasHistoryItemCurrent(previous, node.data, 'text')).toBe(false)

    const markup = renderToStaticMarkup(React.createElement(CanvasHistoryDialog, {
      node,
      onUse: vi.fn(),
      onClose: vi.fn(),
    }))
    expect(markup).toContain('当前文本版本')
    expect(markup).toContain('上一版文本')
    expect(buttonContaining(markup, '当前版本')).toContain('disabled')
    expect(buttonContaining(markup, '选用此版本')).not.toContain('disabled')

    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain("const text = typeof task.result?.text === 'string' ? task.result.text.trim() : ''")
    expect(graph).toContain("text,\n              status: 'ready'")
    expect(graph).toContain("text: type === 'text' && typeof item.text === 'string' ? item.text : historyNode.data.text")
  })

  it('shows history prompt and source metadata with a copy action', () => {
    const generated: CanvasGenerationHistoryItem = {
      id: 'generated',
      text: '生成结果',
      prompt: '写一段悬疑短剧开场',
      modelKey: 'nori-text',
      taskId: 'task-1',
      status: 'ready',
      createdAt: '2026-07-17T00:00:00.000Z',
    }
    const node: CanvasFlowNode = {
      id: 'history-node',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { mediaType: 'text', text: '生成结果', history: [generated] },
    }
    const markup = renderToStaticMarkup(React.createElement(CanvasHistoryDialog, {
      node,
      onUse: vi.fn(),
      onClose: vi.fn(),
    }))

    expect(canvasHistorySourceLabel(generated)).toBe('生成')
    expect(canvasHistorySourceLabel({ ...generated, taskId: undefined, modelKey: undefined, source: 'upload' })).toBe('本地上传')
    expect(markup).toContain('写一段悬疑短剧开场')
    expect(markup).toContain('提示词')
    expect(markup).toContain('生成')
    expect(markup).toContain('aria-label="复制版本 1 提示词"')
  })

  it('renders brush, rectangle, and eraser mask actions in order', () => {
    const rectangle: CanvasMaskAction = {
      kind: 'rectangle',
      start: { x: 0.8, y: 0.9 },
      end: { x: 0.2, y: 0.3 },
    }
    expect(normalizeCanvasMaskRectangle(rectangle.start, rectangle.end)).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.6000000000000001,
      height: 0.6000000000000001,
    })
    expect(isCanvasMaskActionDrawable(rectangle)).toBe(true)
    expect(isCanvasMaskActionDrawable({ kind: 'rectangle', start: { x: 0.5, y: 0.5 }, end: { x: 0.5, y: 0.5 } })).toBe(false)

    const calls: Array<{ method: string; color?: string; values?: number[] }> = []
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineCap: 'butt',
      lineJoin: 'miter',
      fillRect(this: { fillStyle: string }, ...values: number[]) { calls.push({ method: 'fillRect', color: this.fillStyle, values }) },
      beginPath() { calls.push({ method: 'beginPath' }) },
      moveTo(...values: number[]) { calls.push({ method: 'moveTo', values }) },
      lineTo(...values: number[]) { calls.push({ method: 'lineTo', values }) },
      stroke(this: { strokeStyle: string }) { calls.push({ method: 'stroke', color: this.strokeStyle }) },
    } as unknown as CanvasRenderingContext2D
    renderCanvasMaskActions(context, [
      { kind: 'stroke', mode: 'paint', width: 8, points: [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.3 }] },
      rectangle,
      { kind: 'stroke', mode: 'erase', width: 12, points: [{ x: 0.4, y: 0.5 }] },
    ], 200, 100, 2)

    expect(calls[0]).toEqual({ method: 'fillRect', color: '#000', values: [0, 0, 200, 100] })
    expect(calls).toContainEqual({ method: 'moveTo', values: [20, 20] })
    expect(calls).toContainEqual({ method: 'fillRect', color: '#fff', values: [40, 30, 120.00000000000001, 60.00000000000001] })
    expect(calls.filter((call) => call.method === 'stroke').map((call) => call.color)).toEqual(['#fff', '#000'])
  })
})
