import fs from 'node:fs'
import path from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CanvasContextMenu } from '@/features/canvas/components/CanvasMenus'
import { CanvasViewportControls } from '@/features/canvas/components/CanvasToolRail'
import { clampCanvasMenuPoint } from '@/features/canvas/editor-types'

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function nodeMenu(canRegenerate: boolean) {
  return renderToStaticMarkup(React.createElement(CanvasContextMenu, {
    state: { scope: 'node', nodeId: 'node-1', x: 80, y: 60 },
    canPaste: false,
    canRegenerate,
    readOnly: false,
    onAction: vi.fn(),
  }))
}

function buttonContaining(markup: string, label: string): string {
  const labelIndex = markup.indexOf(label)
  expect(labelIndex).toBeGreaterThan(-1)
  const start = markup.lastIndexOf('<button', labelIndex)
  const end = markup.indexOf('</button>', labelIndex)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(labelIndex)
  return markup.slice(start, end + '</button>'.length)
}

describe('FrameOS canvas surface parity regressions', () => {
  it('keeps a real retry action when an existing canvas fails to load', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')

    expect(graph).toContain('画布加载失败：')
    expect(graph).toContain('onClick={() => void query.refetch()}')
    expect(graph).toContain('重试加载')
  })

  it('keeps the verified ordinary-node context menu exact and ordered', () => {
    const markup = nodeMenu(true)
    const labels = ['复制', '创建副本', '重新生成', '删除']
    const positions = labels.map((label) => markup.indexOf(label))

    expect(markup).toContain('role="menu"')
    expect(markup).toContain('aria-label="节点操作"')
    expect((markup.match(/role="menuitem"/g) || [])).toHaveLength(4)
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(markup).toContain('⌘ C')
    expect(markup).toContain('⌘ D')
    expect(markup).toContain('⌫')
    expect(buttonContaining(markup, '重新生成')).not.toContain('disabled')
  })

  it('disables regeneration without a reusable prompt/model and wires all four actions', () => {
    expect(buttonContaining(nodeMenu(false), '重新生成')).toContain('disabled')

    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('const canRegenerateContextNode = Boolean(contextNode?.data.prompt && contextNode.data.generation?.modelKey)')
    expect(graph).toContain("if (action === 'copy') { setNodes")
    expect(graph).toContain('void copySelection(false, [menu.nodeId])')
    expect(graph).toContain("if (action === 'duplicate') duplicateNodes([menu.nodeId])")
    expect(graph).toContain("if (action === 'regenerate') runNodeAction(menu.nodeId, 'regenerate')")
    expect(graph).toContain("if (action === 'delete') removeNodes([menu.nodeId])")
  })

  it('keeps fit on the FrameOS dock and preserves reset in the overflow menu', () => {
    const markup = renderToStaticMarkup(React.createElement(CanvasViewportControls, {
      minimapVisible: true,
      zoom: 1,
      organizeMode: 'horizontal',
      organizeOpen: true,
      canOrganize: true,
      onToggleMinimap: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      onFitView: vi.fn(),
      onResetViewport: vi.fn(),
      onToggleOrganize: vi.fn(),
      onOrganize: vi.fn(),
    }))
    expect(markup).toContain('title="适应画布"')
    expect(markup).toContain('title="重置视图"')
    expect(markup).toContain('title="一键整理 · 按连线横向"')
    expect(markup).toContain('<em>一键整理</em>')
    expect(readSource('src/features/canvas/components/CanvasToolRail.tsx'))
      .toContain("className={organizeMode === 'horizontal' ? 'is-active' : ''}")

    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('onResetViewport={() => void flow?.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 180 })}')
    expect(graph).not.toContain("type: 'smoothstep'")
    expect(readSource('src/features/canvas/editor-types.ts')).toContain("type: 'bezier'")
    expect(readSource('src/features/canvas/components/CanvasMenus.tsx')).toContain('一键整理（从左到右）')
  })

  it('captures MiniMap dragging on the MiniMap panel instead of the workspace', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const start = graph.indexOf('const startMiniMapDrag')
    const end = graph.indexOf('const moveMiniMapDrag', start)
    const implementation = graph.slice(start, end)

    expect(implementation).toContain('panel.setPointerCapture(event.pointerId)')
    expect(implementation).not.toContain('event.currentTarget.setPointerCapture(event.pointerId)')
    expect(graph).toContain('active.panel.releasePointerCapture(pointerId)')
  })

  it('creates new 720 panoramas at the verified 21:9 ratio', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const start = graph.indexOf("if (action !== 'panorama_720') return")
    const end = graph.indexOf('const applyImageOperationResults', start)
    const implementation = graph.slice(start, end)

    expect(implementation).toContain('21:9 超宽幅 720° 全景图')
    expect(implementation).toContain('aspectRatio: CANVAS_PANORAMA_ASPECT_RATIO')
    expect(implementation).not.toContain("aspectRatio: '2:1'")
  })

  it('keeps context and wire menus inside every viewport edge', () => {
    expect(clampCanvasMenuPoint(
      { x: 995, y: 790 },
      { width: 1_000, height: 800 },
      { width: 160, height: 220 },
    )).toEqual({ x: 832, y: 572 })
    expect(clampCanvasMenuPoint(
      { x: -20, y: -30 },
      { width: 1_000, height: 800 },
      { width: 160, height: 220 },
    )).toEqual({ x: 8, y: 8 })

    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('...visibleMenuPoint(point.x, point.y, 210)')
    expect(graph).toContain("scope: 'node', nodeId: node.id, ...visibleMenuPoint")
  })

  it('renders client-coordinate menus outside the zoomed application shell', () => {
    const portal = readSource('src/features/canvas/components/CanvasMenuPortal.tsx')
    const menus = readSource('src/features/canvas/components/CanvasMenus.tsx')
    const projectAssets = readSource('src/features/canvas/components/CanvasProjectAssets.tsx')

    expect(readSource('src/styles/frameos-replica.css')).toContain('zoom: var(--nori-interface-scale, 1.2)')
    expect(portal).toContain('createPortal(children, document.body)')
    expect((menus.match(/<CanvasMenuPortal>/g) || [])).toHaveLength(2)
    expect(projectAssets).toContain('<CanvasMenuPortal>')
  })

  it('does not turn a right-button canvas pan into an accidental menu open', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('rightPanGestureRef')
    expect(graph).toContain('Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4')
    expect(graph).toContain('suppressContextMenuUntilRef.current = Date.now() + 250')
    expect(graph).toContain('if (shouldSuppressContextMenu()) return')
    expect(graph).toContain('panOnDrag={[1, 2]}')
  })

  it('keeps pane-menu node creation and upload anchored at the clicked point', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('pendingInsertPositionRef.current = menu.flowPosition || null')
    expect(graph).toContain('setAddOpen(true)')
    expect(graph).toContain('openUploadPicker(menu.flowPosition)')
    expect(graph).toContain('const position = pendingInsertPositionRef.current || undefined')
    expect(graph).toContain('addNode(type, position)')
    expect(graph).toContain('const position = pendingUploadPositionRef.current || undefined')
    expect(graph).toContain('handleUploads(files, position)')
  })

  it('queues every selected canvas upload instead of treating concurrency two as a file limit', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')

    expect(graph).toContain('Array.from(input).filter((file) => file.size > 0).slice(0, 100)')
    expect(graph).toContain('settleWithConcurrency(files, CANVAS_UPLOAD_CONCURRENCY, uploadMaterial)')
    expect(graph).toContain("results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])")
    expect(graph).toContain('const failed = results.length - materials.length')
    expect(graph).not.toContain('files.slice(0, CANVAS_UPLOAD_CONCURRENCY)')
  })

  it('keeps pane-menu paste available for ordinary system text and media', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    expect(graph).toContain('canPaste={!readOnly && clipboardCanPaste}')
    expect(graph).toContain('resolveCanvasClipboardPasteSource')
    expect(graph).toContain('navigator.clipboard?.read?.()')
    expect(graph).toContain('navigator.clipboard?.readText()')
  })

  it('dismisses transient canvas and breadcrumb menus with Escape or an outside click', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const chrome = readSource('src/features/canvas/components/CanvasChrome.tsx')
    expect(graph).toContain("if (event.key === 'Escape') {")
    expect(graph).toContain('dismissTransientUi()')
    expect(graph).toContain('setAssetsOpen(false)')
    expect(graph).toContain('setPickerOpen(false)')
    expect(graph).toContain('onPaneClick={() => { setAddOpen(false); setOrganizeOpen(false)')
    expect(chrome).toContain("if (event.key !== 'Escape') return")
    expect(chrome).toContain("document.addEventListener('keydown', closeOnEscape)")
    expect(chrome).toContain("document.removeEventListener('keydown', closeOnEscape)")
  })

  it('keeps add, project assets, and help surfaces mutually exclusive', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')

    expect(graph).toContain('setAssetsOpen(false); setHelpOpen(false); setOrganizeOpen(false); setAddOpen((value) => !value)')
    expect(graph).toContain('setAddOpen(false); setHelpOpen(false); setOrganizeOpen(false); setAssetsOpen((value) => !value)')
    expect(graph).toContain('onHelp={() => { setAddOpen(false); setAssetsOpen(false); setOrganizeOpen(false); setHelpOpen((value) => !value) }}')
    expect(graph).toContain('onToggleOrganize={() => { setAddOpen(false); setAssetsOpen(false); setHelpOpen(false); setOrganizeOpen((value) => !value) }}')
    expect(graph).toContain('setOrganizeMode(mode)')
  })
})
