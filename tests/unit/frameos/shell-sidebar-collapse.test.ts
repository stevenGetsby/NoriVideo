import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('FosShell collapsible sidebar', () => {
  it('restores the shared desktop titlebar above the app header', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(shell).toContain('className="fos-titlebar"')
    expect(shell).toContain('className="fos-titlebar-title">LanmiaoTV</span>')
    expect(shell).toContain('aria-label="刷新页面"')
    expect(styles).toContain('--fos-titlebar-height: 32px;')
    expect(styles).toContain('height: var(--fos-titlebar-height);')
  })

  it('wires the existing control to a reversible, accessible sidebar state', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')

    expect(shell).toContain('data-testid="fos-sidebar-toggle"')
    expect(shell).toContain('onClick={onToggle}')
    expect(shell).toContain("aria-label={collapsed ? '展开侧边菜单' : '收起侧边菜单'}")
    expect(shell).toContain('aria-expanded={!collapsed}')
    expect(shell).toContain("name={collapsed ? 'chevronRight' : 'chevronLeft'}")
    expect(shell).toContain('hidden={collapsed}')
  })

  it('hides all navigation icons when collapsed and leaves only the reveal control', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')

    expect(shell).not.toContain('CollapsedCanvasNavigation')
    expect(shell).not.toContain('data-testid="fos-collapsed-nav"')
    expect(shell).not.toContain('data-testid="collapsed-global-canvas-nav"')
    expect(shell).not.toContain('data-testid="collapsed-project-canvas-nav"')
    expect(shell).toContain('data-testid="fos-sidebar-toggle"')
    expect(shell).toContain('hidden={collapsed}')
  })

  it('persists the preference and offers a keyboard shortcut outside editors', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')

    expect(shell).toContain("const FOS_SIDEBAR_STORAGE_KEY = 'nori.fos.sidebarCollapsed'")
    expect(shell).toContain('window.localStorage.getItem(FOS_SIDEBAR_STORAGE_KEY)')
    expect(shell).toContain('window.localStorage.setItem(FOS_SIDEBAR_STORAGE_KEY')
    expect(shell).toContain("event.key.toLowerCase() !== 'b'")
    expect(shell).toContain("target.closest('input, textarea, select')")
  })

  it('lets the left navigator drag horizontally and remembers the width', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')
    const resizer = readSource('src/components/frameos/FosSidebarResizer.tsx')
    const hook = readSource('src/components/frameos/useFosSidebarResize.ts')
    const width = readSource('src/lib/frameos/sidebar-width.ts')
    const styles = readSource('src/styles/frameos-replica.css')

    expect(shell).toContain('useFosSidebarResize')
    expect(shell).toContain("style={{ '--fos-sidebar-width': `${sidebarWidth}px` } as CSSProperties}")
    expect(shell).toContain("sidebarResizing ? ' is-sidebar-resizing' : ''")
    expect(resizer).toContain('data-testid="fos-sidebar-resizer"')
    expect(resizer).toContain('aria-label="调整导航栏宽度"')
    expect(hook).toContain('beginSidebarResize')
    expect(hook).toContain('writeStoredSidebarWidth')
    expect(width).toContain("export const FOS_SIDEBAR_WIDTH_STORAGE_KEY = 'nori.fos.sidebarWidth'")
    expect(width).toContain('export const FOS_SIDEBAR_WIDTH_MIN = 176')
    expect(width).toContain('export const FOS_SIDEBAR_WIDTH_MAX = 420')
    expect(styles).toContain('width: var(--fos-sidebar-width);')
    expect(styles).toContain('flex: 0 0 var(--fos-sidebar-width);')
    expect(styles).toContain('.fos-sidebar-resizer {')
    expect(styles).toContain('cursor: col-resize;')
  })

  it('reclaims most sidebar width without overlaying page or canvas controls', () => {
    const styles = readSource('src/styles/frameos-replica.css')

    expect(styles).toContain('.fos-sidebar.is-collapsed { width: 0; flex-basis: 0; overflow: visible; border-right: 0; padding: 0; }')
    expect(styles).toContain(".fos-sidebar.is-collapsed + .fos-main .works-heading { padding-left: 56px; }")
    expect(styles).toContain(".fos-sidebar.is-collapsed + .fos-main .fa-title-group { padding-left: 81px; }")
    expect(styles).toContain('.fos-sidebar.is-collapsed .fos-sidebar-header { position: fixed; top: 50%; left: 0;')
    expect(styles).toContain('.fos-sidebar-sections[hidden] { display: none; }')
    expect(styles).toContain('.fos-collapse-btn:focus-visible')
    expect(styles).not.toContain('.fos-sidebar-expand-btn')
  })

  it('uses the FrameOS canvas shell geometry without changing ordinary pages', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')
    const shellStyles = readSource('src/styles/frameos-replica.css')
    const chrome = readSource('src/features/canvas/components/CanvasChrome.tsx')
    const canvasStyles = readSource('src/features/canvas/canvas.css')

    expect(shell).toContain("const FOS_CANVAS_SIDEBAR_STORAGE_KEY = 'nori.fos.canvasSidebarCollapsed'")
    expect(shell).toContain("stored === null ? canvasShell : stored === 'true'")
    expect(shell).toContain("<FosHeader canvasMode={canvasShell} />")
    expect(shell).toContain("is-canvas-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : 'is-sidebar-expanded'}")
    expect(shellStyles).toContain('.fos-app.is-canvas-shell .fos-header {')
    expect(shellStyles).toContain('top: var(--fos-titlebar-height);')
    expect(shellStyles).toContain('.fos-app.is-canvas-shell .fos-sidebar {')
    expect(shellStyles).toContain('padding: 68px 8px 16px;')

    expect(chrome).toContain('className="nori-canvas-sidebar-reveal"')
    expect(chrome).toContain('aria-label="展开菜单"')
    expect(chrome).toContain('aria-label="收起菜单"')
    expect(chrome).toContain('canvasShell.toggleSidebar')
    expect(chrome).toContain('className="nori-canvas-dropdown-utilities"')
    expect(chrome).toContain('className="nori-canvas-project-assets-button"')
    expect(canvasStyles).toContain('height: 102px;')
    expect(canvasStyles).toContain('border-radius: 9999px;')
    expect(canvasStyles).toContain('.nori-canvas-project-assets-rail-action { display: none; }')
    expect(canvasStyles).toContain('width: 190px !important;')
    expect(canvasStyles).toContain('height: 120px !important;')
  })

  it('removes the collapsed button residue while preserving an edge reveal target', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')
    const styles = readSource('src/styles/frameos-replica.css')
    const chrome = readSource('src/features/canvas/components/CanvasChrome.tsx')
    const emptyChrome = readSource('src/features/canvas/components/EmptyCanvasChrome.tsx')
    const canvasStyles = readSource('src/features/canvas/canvas.css')

    expect(chrome).toContain('canvasShell.enabled && canvasShell.sidebarCollapsed ? (')
    expect(chrome).toContain('className="nori-canvas-sidebar-reveal"')
    expect(chrome).toContain('!canvasShell.sidebarCollapsed ? (')
    expect(chrome).toContain("? ' is-sidebar-collapsed'")
    expect(chrome).toContain(": ' is-sidebar-expanded'")
    expect(emptyChrome).toContain('className="nori-canvas-sidebar-reveal"')
    expect(emptyChrome).toContain('!canvasShell.sidebarCollapsed ? (')
    expect(canvasStyles).toContain('.nori-canvas-sidebar-reveal {')
    expect(canvasStyles).toMatch(/\.nori-canvas-sidebar-reveal \{[\s\S]*?opacity: 1;/)
    expect(styles).toMatch(/\.fos-sidebar\.is-collapsed \.fos-collapse-btn \{[\s\S]*?opacity: 1;/)
    expect(canvasStyles).toContain('.nori-canvas-sidebar-reveal:hover,')
    expect(styles).toContain('.fos-app.is-canvas-shell.is-sidebar-collapsed .fos-sidebar {')
    expect(styles).toContain('visibility: hidden;')
    expect(styles).toContain('.fos-app.is-canvas-shell .fos-sidebar-header {')
    expect(styles).toContain('.fos-app.is-canvas-shell .fos-sidebar-sections {')
    expect(styles).toContain('min-width: 0;')
    expect(shell).toContain('if (!canvasMode || collapsed) return')
    expect(shell).toContain("target instanceof HTMLElement && target.closest('a')")
    expect(shell).toContain('if (target instanceof HTMLElement && target.closest(\'a\')) onToggle()')
  })

  it('reserves a readable, collision-free safe area below canvas chrome', () => {
    const canvasStyles = readSource('src/features/canvas/canvas.css')

    expect(canvasStyles).toContain('--canvas-chrome-safe-top: 116px;')
    expect(canvasStyles).toContain('.nori-canvas-project-assets,')
    expect(canvasStyles).toContain('top: var(--canvas-chrome-safe-top);')
    expect(canvasStyles).toContain('.nori-canvas-selection-toolbar { top: var(--canvas-chrome-safe-top); }')
    expect(canvasStyles).toContain('.nori-canvas-dropdown-title { color: #b6b7c2; font-size: 11px; }')
    expect(canvasStyles).toContain('.nori-canvas-project-assets-list > article small { color: #a5a6b3; font-size: 10px; }')
  })

  it('shows an assignment attention badge and does not render a fake desktop download', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')
    const styles = readSource('src/styles/frameos-replica.css')
    const assignments = readSource('src/components/frameos/FosAssignmentsClient.tsx')

    expect(shell).toContain("data-testid={item.key === 'assignments' ? 'assignment-nav-count' : undefined}")
    expect(shell).toContain('useAssignmentAttention')
    expect(shell).toContain('assignmentAttentionCount')
    expect(shell).not.toContain('下载桌面端')
    expect(styles).toContain('.fos-nav-count {')
    expect(assignments).toContain('resolveDefaultAssignmentTab')
  })
})
