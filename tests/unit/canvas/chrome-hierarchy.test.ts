import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FosCanvasShellContext } from '@/components/frameos/FosCanvasShellContext'
import { CanvasChrome } from '@/features/canvas/components/CanvasChrome'
import { EmptyCanvasChrome } from '@/features/canvas/components/EmptyCanvasChrome'
import type { Canvas } from '@/features/canvas/types'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string | { pathname: string }; children: React.ReactNode }) => React.createElement('a', { ...props, href: typeof href === 'string' ? href : href.pathname }, children),
}))
vi.mock('@/components/ui/viewport-popover', () => ({ ViewportPopover: () => null }))
vi.mock('@/components/ui/icons', () => ({ AppIcon: () => React.createElement('svg') }))
vi.mock('@/features/canvas/components/CanvasToolRail', () => ({
  CanvasToolRail: () => null,
  CanvasViewportControls: () => null,
}))

const canvas: Canvas = {
  id: 'canvas-1', projectId: 'work-1', title: '不应出现在层级的画布名',
  themeColor: null, viewport: null, revision: 1, visibility: 'PRIVATE', forkedFromId: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}
const noop = () => undefined
const shell = { enabled: true, sidebarCollapsed: true, toggleSidebar: noop }

function render(element: React.ReactElement) {
  return renderToStaticMarkup(React.createElement(FosCanvasShellContext.Provider, { value: shell }, element))
}

describe('canvas chrome project hierarchy', () => {
  it('shows only project and work, with a direct project return independent of the canvas', () => {
    const html = render(React.createElement(CanvasChrome, {
      projectId: 'work-1', projectName: '第 1 章', canvases: [canvas], activeCanvas: canvas,
      saveState: 'saved', canUndo: false, canRedo: false,
      onSelectCanvas: noop, onCreateCanvas: noop, onRenameCanvas: noop, onDeleteCanvas: noop,
      parentProjectId: 'project-1', parentProjectName: '海后穿书',
      onUndo: noop, onRedo: noop, onRetrySave: noop, onOpenRevisions: noop,
      syncingProduction: false, canSyncProduction: true, readOnly: false,
      onOpenProjectAssets: noop, onSyncProduction: noop,
    }))
    expect(html).toContain('海后穿书')
    expect(html).toContain('第 1 章')
    expect(html).not.toContain('不应出现在层级的画布名')
    expect(html).not.toContain('nori-canvas-active-picker')
    expect(html).toContain('data-testid="canvas-parent-back"')
    expect(html).toContain('href="/projects?work_id=project-1"')
    expect(html).toContain('aria-label="返回项目：海后穿书"')
    expect(html).toContain('aria-label="画布工具"')
  })

  it('does not relabel a real project as unassigned while its name is loading', () => {
    const html = render(React.createElement(EmptyCanvasChrome, {
      projectId: 'work-1', projectName: '作品 A', parentProjectId: 'project-1',
    }))
    expect(html).toContain('未命名项目')
    expect(html).not.toContain('未归属项目')
    expect(html).not.toContain('选择画布')
    expect(html).toContain('href="/projects?work_id=project-1"')
  })

  it('keeps the empty-canvas return and two-level hierarchy identical', () => {
    const html = render(React.createElement(EmptyCanvasChrome, {
      projectId: 'work-1', projectName: '作品 A', parentProjectId: 'project-1', parentProjectName: '项目甲',
    }))
    expect(html).toContain('项目甲')
    expect(html).toContain('作品 A')
    expect(html).toContain('data-testid="empty-canvas-parent-back"')
    expect(html).toContain('href="/projects?work_id=project-1"')
    expect(html).not.toContain('nori-canvas-active-picker')
  })
})
