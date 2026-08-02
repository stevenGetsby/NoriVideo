import fs from 'node:fs'
import path from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CanvasToolRail, CanvasViewportControls } from '@/features/canvas/components/CanvasToolRail'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const NOOP = vi.fn()

beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

describe('FrameOS empty-project canvas shell', () => {
  it('keeps the full rail visible but inert before a canvas exists', () => {
    const rail = renderToStaticMarkup(React.createElement(CanvasToolRail, {
      editable: false,
      disabled: true,
      addOpen: false,
      assetsOpen: false,
      onToggleAdd: NOOP,
      onToggleAssets: NOOP,
      onOpenLibrary: NOOP,
      onUpload: NOOP,
      onHelp: NOOP,
    }))

    expect(rail).toContain('aria-label="画布工具栏"')
    expect(rail).toContain('添加节点 · 请先创建画布')
    expect(rail).toContain('从素材库选择 · 请先创建画布')
    expect(rail).toContain('本地上传 · 请先创建画布')
    expect(rail).toContain('帮助 · 请先创建画布')
    expect(rail.match(/disabled=""/g)).toHaveLength(4)
  })

  it('renders the FrameOS viewport dock at 100% with local controls available', () => {
    const dock = renderToStaticMarkup(React.createElement(CanvasViewportControls, {
      minimapVisible: false,
      zoom: 1,
      organizeMode: 'grid',
      organizeOpen: false,
      canOrganize: true,
      onToggleMinimap: NOOP,
      onZoomIn: NOOP,
      onZoomOut: NOOP,
      onFitView: NOOP,
      onResetViewport: NOOP,
      onToggleOrganize: NOOP,
      onOrganize: NOOP,
    }))

    expect(dock).toContain('aria-label="画布视图控制"')
    expect(dock).toContain('title="画布小地图"')
    expect(dock).toContain('title="适应画布"')
    expect(dock).toContain('title="一键整理 · 网格整理"')
    expect(dock).toContain('100%')
    expect(dock).not.toContain('disabled=""')
  })

  it('keeps empty-canvas dock interactions local and bounded without an API call', () => {
    const chrome = readSource('src/features/canvas/components/EmptyCanvasChrome.tsx')
    const controlsStart = chrome.indexOf('export function EmptyCanvasSurfaceControls()')
    const controls = chrome.slice(controlsStart)
    const viewportStart = controls.indexOf('<CanvasViewportControls')
    const viewportEnd = controls.indexOf('/>', viewportStart)
    const viewport = controls.slice(viewportStart, viewportEnd)

    expect(controls).toContain('setMinimapVisible((current) => !current)')
    expect(controls).toContain('Math.min(4, Math.max(.1')
    expect(controls).toContain('onZoomIn={() => stepZoom(.1)}')
    expect(controls).toContain('onZoomOut={() => stepZoom(-.1)}')
    expect(controls).toContain('onFitView={() => setZoom(1)}')
    expect(controls).toContain('onResetViewport={resetViewport}')
    expect(controls).toContain('onOrganize={() => setOrganizeOpen(false)}')
    expect(controls).toContain('nori-canvas-empty-minimap')
    expect(viewport).not.toContain('disabled')
    expect(controls).not.toContain('canvasApi.')
    expect(controls).not.toContain('/api/')
  })

  it('uses a real three-level hierarchy without manufacturing an active canvas', () => {
    const workspace = readSource('src/features/canvas/CanvasWorkspace.tsx')
    const chrome = readSource('src/features/canvas/components/EmptyCanvasChrome.tsx')
    const emptyBranchStart = workspace.indexOf('if (!activeCanvas) {')
    const populatedBranchStart = workspace.indexOf('\n  return (', emptyBranchStart)
    const emptyBranch = workspace.slice(emptyBranchStart, populatedBranchStart)
    const workPicker = chrome.indexOf('data-testid="empty-canvas-work-picker"')
    const hierarchyGuard = chrome.lastIndexOf('{hasGlobalHierarchy ? (', workPicker)
    const projectPicker = chrome.indexOf('data-testid="empty-canvas-project-picker"')

    expect(chrome).toContain('data-testid="empty-canvas-work-picker"')
    expect(chrome).toContain('data-testid="empty-canvas-project-picker"')
    expect(chrome).toContain('data-testid="empty-canvas-picker"')
    expect(chrome).toContain('<span>选择画布</span>')
    expect(chrome).toContain('aria-current="step" disabled')
    expect(chrome).toContain('onSelectProject?.(project.id)')
    expect(hierarchyGuard).toBeGreaterThan(-1)
    expect(hierarchyGuard).toBeLessThan(workPicker)
    expect(workPicker).toBeLessThan(projectPicker)
    expect(chrome).not.toContain("'我的作品'")

    expect(emptyBranch).toContain('<EmptyCanvasChrome')
    expect(emptyBranch).toContain('<EmptyCanvasSurfaceControls />')
    expect(emptyBranch).toContain('data-testid="empty-canvas-shell"')
    expect(emptyBranch).not.toContain('<CanvasGraph')
    expect(emptyBranch).not.toContain('activeCanvas.id')
    expect(emptyBranch).not.toContain('canvasApi.')
  })

  it('offers creation only to editors and explains read-only access', () => {
    const workspace = readSource('src/features/canvas/CanvasWorkspace.tsx')
    const styles = readSource('src/features/canvas/canvas.css')

    expect(workspace).toContain("canEdit ? '创建第一张画布' : '暂无可查看的画布'")
    expect(workspace).toContain('当前账号拥有查看权限，但项目还没有画布。请联系管理账号或分镜师创建。')
    expect(workspace).toContain('{canEdit ? <button type="button" disabled={managementBusy} onClick={requestCreateCanvas}>')
    expect(styles).toContain('.nori-canvas-empty-grid')
    expect(styles).toContain('.nori-canvas-tool-rail button:disabled')
    expect(styles).toContain('.nori-canvas-viewport-controls.is-disabled > button:disabled')
  })
})
