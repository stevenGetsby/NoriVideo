'use client'

import { useEffect, useRef, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { useFosCanvasShell } from '@/components/frameos/FosCanvasShellContext'
import type { Canvas, CanvasProjectOption } from '../types'

export type CanvasSaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'conflict' | 'error' | 'offline' | 'recovery'

function SaveStatus({ state, onRetry }: { state: CanvasSaveState; onRetry: () => void }) {
  const info: { icon: AppIconName; label: string; spin: boolean } = state === 'saving' || state === 'pending'
    ? { icon: 'loader', label: '保存中', spin: true }
    : state === 'saved'
      ? { icon: 'check', label: '已保存', spin: false }
      : state === 'conflict'
        ? { icon: 'alert', label: '多标签冲突', spin: false }
        : state === 'recovery'
          ? { icon: 'history', label: '本地版本待确认', spin: false }
          : state === 'offline'
            ? { icon: 'cloudOff', label: '本地已缓存', spin: false }
        : state === 'error'
          ? { icon: 'cloudOff', label: '保存失败', spin: false }
          : { icon: 'cloud', label: '自动保存', spin: false }
  return <button type="button" className={`nori-canvas-save-state is-${state}`} title={state === 'offline' ? '修改已保存在当前浏览器，点击立即重试同步' : undefined} onClick={state === 'error' || state === 'offline' ? onRetry : undefined}><AppIcon name={info.icon} className={info.spin ? 'animate-spin' : ''} /><span>{info.label}</span></button>
}

export function CanvasChrome({
  projectId,
  projectName,
  canvases,
  activeCanvas,
  saveState,
  canUndo,
  canRedo,
  onSelectCanvas,
  onCreateCanvas,
  onRenameCanvas,
  onDeleteCanvas,
  projectOptions,
  onSelectProject,
  canvasHomeHref,
  createProjectHref,
  onUndo,
  onRedo,
  onRetrySave,
  onOpenRevisions,
  syncingProduction,
  canSyncProduction,
  readOnly,
  onOpenProjectAssets,
  onSyncProduction,
}: {
  projectId: string
  projectName: string
  canvases: Canvas[]
  activeCanvas: Canvas
  saveState: CanvasSaveState
  canUndo: boolean
  canRedo: boolean
  onSelectCanvas: (canvasId: string) => void
  onCreateCanvas: () => void
  onRenameCanvas: () => void
  onDeleteCanvas: () => void
  projectOptions?: CanvasProjectOption[]
  onSelectProject?: (projectId: string) => void
  canvasHomeHref?: string
  createProjectHref?: string
  onUndo: () => void
  onRedo: () => void
  onRetrySave: () => void
  onOpenRevisions: () => void
  syncingProduction: boolean
  canSyncProduction: boolean
  readOnly: boolean
  onOpenProjectAssets: () => void
  onSyncProduction: () => void
}) {
  const canvasShell = useFosCanvasShell()
  const [menu, setMenu] = useState<'work' | 'project' | 'canvas' | null>(null)
  const [keyword, setKeyword] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const activeProject = projectOptions?.find((project) => project.id === projectId) || null
  const activeWorkId = activeProject?.workId || null
  const hasGlobalHierarchy = Boolean(canvasHomeHref && activeWorkId && projectOptions?.length)
  const workOptions = Array.from(new Map((projectOptions || []).flatMap((project) => (
    project.workId ? [[project.workId, { id: project.workId, name: project.workName || '未归属作品' }] as const] : []
  ))).values())
  const visibleProjects = hasGlobalHierarchy
    ? (projectOptions || []).filter((project) => project.workId === activeWorkId)
    : projectOptions
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()
  const filteredWorkOptions = normalizedKeyword
    ? workOptions.filter((work) => work.name.toLocaleLowerCase().includes(normalizedKeyword))
    : workOptions
  const filteredProjects = normalizedKeyword
    ? (visibleProjects || []).filter((project) => project.name.toLocaleLowerCase().includes(normalizedKeyword))
    : visibleProjects
  const toggleMenu = (next: 'work' | 'project' | 'canvas') => {
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
    <div className={`nori-canvas-chrome${sidebarStateClass}`} ref={rootRef}>
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
      <div className={`nori-canvas-breadcrumbs${hasGlobalHierarchy ? ' is-global-hierarchy' : ''}`}>
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
          data-testid="canvas-parent-back"
        ><AppIcon name="chevronLeft" /><span>{canvasHomeHref ? '画布首页' : '项目工作台'}</span></Link>
        <span className="nori-canvas-nav-divider" />
        {hasGlobalHierarchy ? (
          <>
            <button type="button" data-testid="global-canvas-active-work-picker" onClick={() => toggleMenu('work')}><span>{activeProject?.workName || '未归属作品'}</span><AppIcon name="chevronDown" /></button>
            <i>/</i>
          </>
        ) : null}
        <button type="button" className="nori-canvas-project-picker" onClick={() => toggleMenu('project')}><span>{projectName}</span><AppIcon name="chevronDown" /></button>
        <i>/</i>
        <button type="button" className="nori-canvas-active-picker" onClick={() => toggleMenu('canvas')}><span>{activeCanvas.title}</span><AppIcon name="chevronDown" /></button>
        {menu === 'work' && hasGlobalHierarchy ? (
          <div className="nori-canvas-dropdown nori-canvas-project-dropdown nori-canvas-work-dropdown">
            <div className="nori-canvas-dropdown-title">选择作品</div>
            <label className="nori-canvas-dropdown-search"><AppIcon name="search" /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索作品" autoFocus /></label>
            <div className="nori-canvas-dropdown-scroll">
              {filteredWorkOptions.map((work) => (
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
              {filteredWorkOptions.length === 0 ? <p className="nori-canvas-dropdown-empty">没有匹配的作品</p> : null}
            </div>
          </div>
        ) : null}
        {menu === 'project' ? (
          <div className="nori-canvas-dropdown nori-canvas-project-dropdown">
            <div className="nori-canvas-dropdown-title">{visibleProjects?.length ? `${hasGlobalHierarchy ? `${activeProject?.workName || '作品'} · ` : ''}选择项目` : '当前项目'}</div>
            {visibleProjects?.length && onSelectProject ? (
              <>
                <label className="nori-canvas-dropdown-search"><AppIcon name="search" /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索项目" autoFocus /></label>
                <div className="nori-canvas-dropdown-scroll">
                  {filteredProjects?.map((project) => (
                    <button
                      type="button"
                      key={project.id}
                      className={project.id === projectId ? 'is-active' : ''}
                      onClick={() => { onSelectProject(project.id); setMenu(null) }}
                    >
                      <span>{project.name}</span>
                      <small>{project.workName || '未归属作品'}</small>
                      {project.id === projectId ? <AppIcon name="check" /> : null}
                    </button>
                  ))}
                  {filteredProjects?.length === 0 ? <p className="nori-canvas-dropdown-empty">没有匹配的项目</p> : null}
                </div>
              </>
            ) : (
              <Link href={{ pathname: '/works' }}><span>{projectName}</span><small>返回作品列表切换项目</small></Link>
            )}
            {hasGlobalHierarchy && createProjectHref ? (
              <div className="nori-canvas-dropdown-actions nori-canvas-project-actions">
                <Link href={createProjectHref} data-testid="global-canvas-active-create-project" onClick={() => setMenu(null)}><AppIcon name="plus" />在此作品中新建项目</Link>
              </div>
            ) : null}
          </div>
        ) : null}
        {menu === 'canvas' ? (
          <div className="nori-canvas-dropdown nori-canvas-list-dropdown">
            <div className="nori-canvas-dropdown-title">选择画布</div>
            <div className="nori-canvas-dropdown-scroll">
              {canvases.map((canvas) => (
                <button type="button" key={canvas.id} className={canvas.id === activeCanvas.id ? 'is-active' : ''} onClick={() => { onSelectCanvas(canvas.id); setMenu(null) }}>
                  <span>{canvas.title}</span><small>{canvas.id === activeCanvas.id ? activeCanvas.nodeCount ?? canvas.nodeCount ?? 0 : canvas.nodeCount ?? 0} 个节点 · {new Date(canvas.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>{canvas.id === activeCanvas.id ? <AppIcon name="check" /> : null}
                </button>
              ))}
            </div>
            {readOnly ? (
              <div className="nori-canvas-dropdown-readonly"><AppIcon name="lock" />当前账号仅可查看画布</div>
            ) : (
              <div className="nori-canvas-dropdown-actions">
                <button type="button" onClick={() => { onCreateCanvas(); setMenu(null) }}><AppIcon name="plus" />新建画布</button>
                <button type="button" onClick={() => { onRenameCanvas(); setMenu(null) }}><AppIcon name="edit" />重命名</button>
                <button type="button" className="is-danger" title={canvases.length === 1 ? '删除后回到画布创建引导' : '删除当前画布'} onClick={() => { onDeleteCanvas(); setMenu(null) }}><AppIcon name="trash" />删除</button>
              </div>
            )}
            <div className="nori-canvas-dropdown-utilities">
              <button type="button" className="nori-canvas-project-assets-button" title={readOnly ? '当前账号只有查看权限' : '打开项目资产'} disabled={readOnly} onClick={() => { onOpenProjectAssets(); setMenu(null) }}><AppIcon name="folderOpen" /><span>项目资产</span></button>
              <button type="button" className="nori-canvas-sync-button" title={canSyncProduction ? '同步项目剧本、分镜、图片和视频到当前画布' : '当前账号只有查看权限'} disabled={!canSyncProduction || syncingProduction} onClick={() => { onSyncProduction(); setMenu(null) }}>
                <AppIcon name="refresh" className={syncingProduction ? 'animate-spin' : ''} /><span>{syncingProduction ? '同步中' : '同步项目'}</span>
              </button>
              <button type="button" className="nori-canvas-history-button" title="历史版本" onClick={() => { onOpenRevisions(); setMenu(null) }}><AppIcon name="history" /><span>历史</span></button>
              {readOnly ? <span className="nori-canvas-readonly-state" title="当前账号只有查看权限"><AppIcon name="lock" /><span>只读</span></span> : <SaveStatus state={saveState} onRetry={onRetrySave} />}
            </div>
          </div>
        ) : null}
      </div>
      <div className="nori-canvas-chrome-actions">
        <div className="nori-canvas-undo-redo">
          <button type="button" aria-label="撤销" title={readOnly ? '只读模式不可撤销' : '撤销 ⌘Z'} disabled={readOnly || !canUndo} onClick={onUndo}><AppIcon name="undo" /></button>
          <button type="button" aria-label="重做" title={readOnly ? '只读模式不可重做' : '重做 ⇧⌘Z'} disabled={readOnly || !canRedo} onClick={onRedo}><AppIcon name="redo" /></button>
        </div>
      </div>
    </div>
  )
}
