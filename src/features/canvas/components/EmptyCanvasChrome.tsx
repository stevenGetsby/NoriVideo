'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { useFosCanvasShell } from '@/components/frameos/FosCanvasShellContext'
import type { CanvasProjectOption } from '../types'
import { CanvasToolRail, CanvasViewportControls } from './CanvasToolRail'

const NOOP = () => undefined

export function EmptyCanvasChrome({
  projectId,
  projectName,
  projectOptions,
  onSelectProject,
  canvasHomeHref,
}: {
  projectId: string
  projectName: string
  projectOptions?: CanvasProjectOption[]
  onSelectProject?: (projectId: string) => void
  canvasHomeHref?: string
}) {
  const canvasShell = useFosCanvasShell()
  const rootRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<'work' | 'project' | null>(null)
  const [keyword, setKeyword] = useState('')
  const activeProject = projectOptions?.find((project) => project.id === projectId) || null
  const activeWorkId = activeProject?.workId || null
  const hasGlobalHierarchy = Boolean(canvasHomeHref && activeWorkId && projectOptions?.length)
  const workOptions = useMemo(() => Array.from(new Map((projectOptions || []).flatMap((project) => (
    project.workId ? [[project.workId, { id: project.workId, name: project.workName || '未归属作品' }] as const] : []
  ))).values()), [projectOptions])
  const projectChoices = hasGlobalHierarchy
    ? (projectOptions || []).filter((project) => project.workId === activeWorkId)
    : projectOptions || []
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()
  const filteredWorks = normalizedKeyword
    ? workOptions.filter((work) => work.name.toLocaleLowerCase().includes(normalizedKeyword))
    : workOptions
  const filteredProjects = normalizedKeyword
    ? projectChoices.filter((project) => project.name.toLocaleLowerCase().includes(normalizedKeyword))
    : projectChoices
  const canPickWork = hasGlobalHierarchy && workOptions.length > 0
  const canPickProject = Boolean(onSelectProject && projectChoices.length > 0)

  const toggleMenu = (next: 'work' | 'project') => {
    setKeyword('')
    setMenu((current) => current === next ? null : next)
  }

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenu(null)
      setKeyword('')
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useEffect(() => {
    setMenu(null)
    setKeyword('')
  }, [canvasShell.sidebarCollapsed])

  const sidebarStateClass = !canvasShell.enabled
    ? ''
    : canvasShell.sidebarCollapsed
      ? ' is-sidebar-collapsed'
      : ' is-sidebar-expanded'

  return (
    <div className={`nori-canvas-chrome nori-canvas-empty-chrome${sidebarStateClass}`} ref={rootRef}>
      {canvasShell.enabled && canvasShell.sidebarCollapsed ? (
        <button
          type="button"
          className="nori-canvas-sidebar-reveal"
          aria-label="展开菜单"
          title="展开菜单（⌘/Ctrl+B）"
          aria-expanded={false}
          onClick={canvasShell.toggleSidebar}
        >
          <AppIcon name="chevronRight" />
        </button>
      ) : null}
      <div className={`nori-canvas-breadcrumbs${hasGlobalHierarchy ? ' is-global-hierarchy' : ''}`} aria-label="画布层级">
        {canvasShell.enabled && !canvasShell.sidebarCollapsed ? (
            <button
              type="button"
              className="nori-canvas-sidebar-toggle"
              aria-label="收起菜单"
              title="收起菜单（⌘/Ctrl+B）"
              aria-expanded
              onClick={canvasShell.toggleSidebar}
            >
              <AppIcon name="chevronLeft" />
            </button>
        ) : null}
        <Link
          href={{ pathname: canvasHomeHref || `/workflow/${projectId}/workbench-premium2` }}
          className="nori-canvas-parent-back"
          title={canvasHomeHref ? '返回无限画布首页' : '返回项目工作台'}
          data-testid="empty-canvas-parent-back"
        ><AppIcon name="chevronLeft" /><span>{canvasHomeHref ? '画布首页' : '项目工作台'}</span></Link>
        <span className="nori-canvas-nav-divider" />
        {hasGlobalHierarchy ? (
          <>
            <button
              type="button"
              data-testid="empty-canvas-work-picker"
              disabled={!canPickWork}
              onClick={() => toggleMenu('work')}
            >
              <span>{activeProject?.workName || '作品'}</span><AppIcon name="chevronDown" />
            </button>
            <i>/</i>
          </>
        ) : null}
        <button
          type="button"
          className="nori-canvas-project-picker"
          data-testid="empty-canvas-project-picker"
          disabled={!canPickProject}
          onClick={() => toggleMenu('project')}
        >
          <span>{projectName}</span><AppIcon name="chevronDown" />
        </button>
        <i>/</i>
        <button type="button" className="nori-canvas-active-picker is-empty" data-testid="empty-canvas-picker" aria-current="step" disabled>
          <span>选择画布</span><AppIcon name="chevronDown" />
        </button>

        {menu === 'work' && canPickWork ? (
          <div className="nori-canvas-dropdown nori-canvas-project-dropdown nori-canvas-work-dropdown">
            <div className="nori-canvas-dropdown-title">选择作品</div>
            <label className="nori-canvas-dropdown-search"><AppIcon name="search" /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索作品" autoFocus /></label>
            <div className="nori-canvas-dropdown-scroll">
              {filteredWorks.map((work) => (
                <Link
                  key={work.id}
                  href={`${canvasHomeHref}?work_id=${encodeURIComponent(work.id)}`}
                  className={work.id === activeWorkId ? 'is-active' : ''}
                  onClick={() => setMenu(null)}
                >
                  <span>{work.name}</span>
                  <small>{(projectOptions || []).filter((project) => project.workId === work.id).length} 个项目</small>
                  {work.id === activeWorkId ? <AppIcon name="check" /> : null}
                </Link>
              ))}
              {filteredWorks.length === 0 ? <p className="nori-canvas-dropdown-empty">没有匹配的作品</p> : null}
            </div>
          </div>
        ) : null}

        {menu === 'project' && canPickProject ? (
          <div className="nori-canvas-dropdown nori-canvas-project-dropdown">
            <div className="nori-canvas-dropdown-title">选择项目</div>
            <label className="nori-canvas-dropdown-search"><AppIcon name="search" /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索项目" autoFocus /></label>
            <div className="nori-canvas-dropdown-scroll">
              {filteredProjects.map((project) => (
                <button
                  type="button"
                  key={project.id}
                  className={project.id === projectId ? 'is-active' : ''}
                  onClick={() => { onSelectProject?.(project.id); setMenu(null) }}
                >
                  <span>{project.name}</span>
                  <small>{project.workName || '未归属作品'}</small>
                  {project.id === projectId ? <AppIcon name="check" /> : null}
                </button>
              ))}
              {filteredProjects.length === 0 ? <p className="nori-canvas-dropdown-empty">没有匹配的项目</p> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function EmptyCanvasSurfaceControls() {
  const [minimapVisible, setMinimapVisible] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const stepZoom = (delta: number) => {
    setZoom((current) => Math.min(4, Math.max(.1, Math.round((current + delta) * 10) / 10)))
  }
  const resetViewport = () => {
    setZoom(1)
    setOrganizeOpen(false)
  }

  return (
    <>
      <CanvasToolRail
        editable={false}
        disabled
        addOpen={false}
        assetsOpen={false}
        onToggleAdd={NOOP}
        onToggleAssets={NOOP}
        onOpenLibrary={NOOP}
        onUpload={NOOP}
        onHelp={NOOP}
      />
      <CanvasViewportControls
        minimapVisible={minimapVisible}
        zoom={zoom}
        organizeMode="grid"
        organizeOpen={organizeOpen}
        canOrganize
        onToggleMinimap={() => setMinimapVisible((current) => !current)}
        onZoomIn={() => stepZoom(.1)}
        onZoomOut={() => stepZoom(-.1)}
        onFitView={() => setZoom(1)}
        onResetViewport={resetViewport}
        onToggleOrganize={() => setOrganizeOpen((current) => !current)}
        onOrganize={() => setOrganizeOpen(false)}
      />
      {minimapVisible ? <div className="nori-canvas-empty-minimap" aria-label="空画布小地图"><span /></div> : null}
    </>
  )
}
