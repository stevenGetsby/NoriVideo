import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CanvasContextMenu, CanvasEmptyState } from '@/features/canvas/components/CanvasMenus'
import { CanvasToolRail } from '@/features/canvas/components/CanvasToolRail'
import { canEditInfiniteCanvas } from '@/features/canvas/permissions'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

describe('infinite canvas permission-aware UI', () => {
  it('allows every authenticated work-front role to use the shared creative canvas', () => {
    expect(canEditInfiniteCanvas({ role: 'super_admin' })).toBe(true)
    expect(canEditInfiniteCanvas({ role: 'admin' })).toBe(true)
    expect(canEditInfiniteCanvas({ role: 'storyboard' })).toBe(true)
    expect(canEditInfiniteCanvas({ role: 'writer' })).toBe(true)
    expect(canEditInfiniteCanvas({ role: 'asset' })).toBe(true)
    expect(canEditInfiniteCanvas({ role: 'writer', permissions: ['read'] })).toBe(false)
    expect(canEditInfiniteCanvas(undefined)).toBe(false)
    expect(canEditInfiniteCanvas({ role: 'unknown-role' })).toBe(false)
  })

  it('keeps only non-mutating context actions in read-only mode', () => {
    const nodeMenu = renderToStaticMarkup(React.createElement(CanvasContextMenu, {
      state: { scope: 'node', nodeId: 'node-1', x: 0, y: 0 },
      canPaste: false,
      canRegenerate: true,
      readOnly: true,
      onAction: vi.fn(),
    }))
    expect(nodeMenu).toContain('复制')
    expect(nodeMenu).not.toContain('创建副本')
    expect(nodeMenu).not.toContain('重新生成')
    expect(nodeMenu).not.toContain('删除')

    const paneMenu = renderToStaticMarkup(React.createElement(CanvasContextMenu, {
      state: { scope: 'pane', x: 0, y: 0 },
      canPaste: true,
      canRegenerate: false,
      readOnly: true,
      onAction: vi.fn(),
    }))
    expect(paneMenu).toContain('重置视图')
    expect(paneMenu).not.toContain('添加节点')
    expect(paneMenu).not.toContain('上传文件')
    expect(paneMenu).not.toContain('粘贴')
    expect(paneMenu).not.toContain('整理')
  })

  it('hides creation, asset insertion and upload affordances but keeps help and empty-state visibility', () => {
    const rail = renderToStaticMarkup(React.createElement(CanvasToolRail, {
      editable: false,
      addOpen: false,
      assetsOpen: false,
      onToggleAdd: vi.fn(),
      onToggleAssets: vi.fn(),
      onOpenLibrary: vi.fn(),
      onUpload: vi.fn(),
      onHelp: vi.fn(),
    }))
    expect(rail).toContain('帮助')
    expect(rail).not.toContain('添加节点')
    expect(rail).not.toContain('项目资产')
    expect(rail).not.toContain('从素材库选择')
    expect(rail).not.toContain('本地上传')

    const empty = renderToStaticMarkup(React.createElement(CanvasEmptyState, {
      readOnly: true,
      onAdd: vi.fn(),
      onUpload: vi.fn(),
    }))
    expect(empty).toContain('只读模式')
    expect(empty).not.toContain('<button')
  })

  it('guards workspace and graph mutation surfaces while preserving viewport controls', () => {
    const workspace = source('src/features/canvas/CanvasWorkspace.tsx')
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    const chrome = source('src/features/canvas/components/CanvasChrome.tsx')

    expect(workspace).toContain('const canEdit = canEditInfiniteCanvas(session?.user)')
    expect(workspace).toContain('if (!canEdit || managementBusy) return')
    expect(workspace).toContain('if (!canEdit || !activeCanvas || managementBusy) return')
    expect(workspace).not.toContain('if (!canEdit || !activeCanvas || canvases.length <= 1) return')
    expect(workspace).toContain('window.localStorage.removeItem(`nori-canvas-active:${projectId}`)')

    expect(graph).toContain('const writeLocked = readOnly || productionSyncing || offlineRecoveryBlocking')
    expect(graph).toContain('nodesDraggable={!writeLocked}')
    expect(graph).toContain('nodesConnectable={!writeLocked}')
    expect(graph).toContain("if (!writeLocked && changed) markChanged('调整画布视图')")
    expect(graph).toContain('Math.abs(previous.zoom - next.zoom) > 0.0001')
    expect(graph).toContain("change.type === 'dimensions' && Boolean(change.setAttributes)")
    expect(graph).toContain('{!readOnly && selectedCreativeNode ? <CanvasGenerator')
    expect(graph).toContain('<CanvasToolRail editable={!readOnly}')
    expect(graph).toContain('canOrganize={!readOnly}')
    expect(chrome).toContain('当前账号仅可查看画布')
    expect(chrome).toContain("readOnly ? <span className=\"nori-canvas-readonly-state\"")
  })

  it('shows each canvas node count from the list API and keeps the active count live', () => {
    const route = source('src/app/api/projects/[projectId]/canvas/route.ts')
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    const chrome = source('src/features/canvas/components/CanvasChrome.tsx')

    expect(route).toContain('_count: { select: { nodes: true } }')
    expect(route).toContain('nodeCount: _count.nodes')
    expect(route).toContain('nodeCount: 0')
    expect(graph).toContain('nodeCount: nodes.length')
    expect(chrome).toContain('个节点 ·')
  })
})
