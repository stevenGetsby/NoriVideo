import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasNodeToFlow, flowNodeToCanvas, type CanvasFlowNode } from '@/features/canvas/editor-types'
import { STUDIO_NODE_MIN_SIZE } from '@/features/canvas/studio-types'
import type { CanvasNode } from '@/features/canvas/types'

const editor = vi.hoisted(() => ({ readOnly: false, runNodeAction: vi.fn() }))
vi.mock('@/features/canvas/CanvasEditorContext', () => ({ useCanvasEditor: () => editor }))
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  NodeToolbar: ({ children, className }: { children: React.ReactNode; className: string }) => React.createElement('div', { className }, children),
  NodeResizer: ({ isVisible }: { isVisible: boolean }) => React.createElement('div', { 'data-resizer-visible': String(isVisible) }),
  Handle: () => React.createElement('div'),
}))
import { Studio3DNode } from '@/features/canvas/nodes/Studio3DNode'
import type { NodeProps } from '@xyflow/react'

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  editor.readOnly = false
  vi.clearAllMocks()
})

const props: NodeProps<CanvasFlowNode> = {
  id: 'studio-1', type: 'studio_3d', selected: true, dragging: false, draggable: true,
  selectable: true, deletable: true, zIndex: 1, isConnectable: true,
  positionAbsoluteX: 0, positionAbsoluteY: 0,
  data: { title: '3D 导演台', studioSummary: { version: 1, objectCount: 12, cameraCount: 8, captureCount: 24, hasPanorama: true } },
}

function node(width: number, height: number): CanvasNode {
  return {
    id: 'studio-1', canvasId: 'canvas-1', type: 'studio_3d',
    position: { x: 25, y: 50 }, size: { width, height }, data: {},
    status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null,
  }
}

describe('3D studio node interaction contract', () => {
  it('makes the card and title draggable while isolating toolbar actions', () => {
    const html = renderToStaticMarkup(React.createElement(Studio3DNode, props))
    expect(html).toContain('class="nori-canvas-studio-node-body" role="button" tabindex="0"')
    expect(html).toContain('class="nori-canvas-node-drag-handle"')
    expect(html).toContain('class="nori-canvas-node-toolbar nodrag nowheel"')
    expect(html).not.toContain('class="nodrag nori-canvas-studio-node-body"')
    expect(html).toContain('拖动节点 · 双击进入导演台')
  })

  it('keeps counts in separate wrapping items and the panorama status on its own line', () => {
    const html = renderToStaticMarkup(React.createElement(Studio3DNode, props))
    expect(html).toContain('<span>12 个模型</span><span>8 个机位</span><span>24 张截图</span>')
    expect(html).toContain('<small>已连接 720 全景背景</small>')
  })

  it('retains double-click and keyboard access to the studio', () => {
    const tree = Studio3DNode(props)
    const children = React.Children.toArray(tree.props.children)
    const body = children.find((child) => React.isValidElement<{ className?: string }>(child)
      && child.props.className === 'nori-canvas-studio-node-body') as React.ReactElement<{
        onDoubleClick: () => void
        onKeyDown: (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => void
      }>
    body.props.onDoubleClick()
    for (const key of ['Enter', ' ']) {
      const event = { key, preventDefault: vi.fn(), stopPropagation: vi.fn() }
      body.props.onKeyDown(event)
      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.stopPropagation).toHaveBeenCalled()
    }
    expect(editor.runNodeAction).toHaveBeenCalledTimes(3)
    expect(editor.runNodeAction).toHaveBeenLastCalledWith('studio-1', 'studio_3d')
  })

  it('keeps read-only viewing without resize controls or a drag cursor', () => {
    editor.readOnly = true
    const html = renderToStaticMarkup(React.createElement(Studio3DNode, props))
    expect(html).toContain('is-readonly')
    expect(html).toContain('data-resizer-visible="false"')
    expect(html).toContain('查看导演台')
    expect(html).not.toContain('拖动节点')
  })

  it('normalizes undersized saved nodes to the same dimensions as the rendered card and resizer', () => {
    const flow = canvasNodeToFlow(node(180, 120))
    expect({ width: flow.width, height: flow.height }).toEqual(STUDIO_NODE_MIN_SIZE)
    expect(flow.position).toEqual({ x: 25, y: 50 })
    expect(flowNodeToCanvas({ ...flow, width: 200, height: 160 }, 'canvas-1').size).toEqual(STUDIO_NODE_MIN_SIZE)
  })

  it('preserves larger studio sizes and does not change other node types', () => {
    const large = canvasNodeToFlow(node(640, 480))
    expect(flowNodeToCanvas(large, 'canvas-1').size).toEqual({ width: 640, height: 480 })
    const image = canvasNodeToFlow({ ...node(180, 120), type: 'image' })
    expect({ width: image.width, height: image.height }).toEqual({ width: 180, height: 120 })
  })
})
