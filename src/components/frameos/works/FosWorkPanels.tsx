'use client'

import { Fragment, useRef } from 'react'
import { useSession } from 'next-auth/react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import { isManagementRole } from '@/lib/account/permissions'
import { coverMonogram, generativeCoverStyle } from '@/lib/ui/generative-cover'
import type { WorkProject, WorkSummary } from './types'
import { UNASSIGNED_WORK_ID } from './types'
import { canMoveFromWork } from './FosWorksDialogs'
import { projectAspectRatio, projectGenreLabel } from './project-metadata'

export { projectAspectRatio, projectGenreLabel } from './project-metadata'

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '—'
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Shanghai',
  })
}

function Highlight({ text, keyword }: { text: string; keyword: string }) {
  const query = keyword.trim()
  if (!query) return <>{text}</>
  const source = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  const parts: Array<{ value: string; match: boolean }> = []
  let cursor = 0
  while (cursor < text.length) {
    const matchIndex = source.indexOf(needle, cursor)
    if (matchIndex < 0) {
      parts.push({ value: text.slice(cursor), match: false })
      break
    }
    if (matchIndex > cursor) parts.push({ value: text.slice(cursor, matchIndex), match: false })
    parts.push({ value: text.slice(matchIndex, matchIndex + query.length), match: true })
    cursor = matchIndex + query.length
  }
  return <>{parts.map((part, index) => <Fragment key={`${index}:${part.value}`}>{part.match ? <mark className="works-highlight">{part.value}</mark> : part.value}</Fragment>)}</>
}

function projectBudgetLevel(project: WorkProject) {
  return project.budgetLevel?.trim()
    || project.novelPromotionData?.budgetLevel?.trim()
    || project.novelPromotionData?.projectLevel?.trim()
    || ''
}

function projectEdition(project: WorkProject) {
  const explicitName = project.budgetLevelName?.trim()
    || project.novelPromotionData?.budgetLevelName?.trim()
    || project.novelPromotionData?.projectLevelName?.trim()
  if (explicitName) return explicitName
  const level = projectBudgetLevel(project)
  if (level === 'Nori1.0') return 'Nori1.0'
  if (level === 'premium2') return '精品版 2.0'
  if (level === 'premium' || level === 'professional') return '精品版'
  if (level === 'efficient') return '高效版'
  if (level === 'custom') return '定制版'
  return level || '工具箱'
}

function projectEditionTone(project: WorkProject) {
  const level = projectBudgetLevel(project)
  if (!level) return ' is-toolbox'
  if (level === 'efficient') return ' is-efficient'
  return ' is-premium'
}

function projectStyle(project: WorkProject) {
  const style = project.artStyle?.trim()
  if (!style) return null
  if (style === 'anime-3d') return '3D 动漫'
  if (style === 'anime-2.5d') return '2.5D 动漫'
  if (style === 'anime-2d') return '2D 动漫'
  if (style === 'anime') return '动漫'
  if (style === 'live-action') return '仿真人'
  if (style === 'american-comic') return '美漫风'
  return style
}

function focusMenuEdge(trigger: HTMLElement, edge: 'first' | 'last') {
  window.requestAnimationFrame(() => {
    const menuId = trigger.getAttribute('aria-controls')
    const menu = (menuId ? document.getElementById(menuId) : null)
      || trigger.parentElement?.querySelector<HTMLElement>('[role="menu"]')
    const items = menu
      ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))
      : []
    items[edge === 'first' ? 0 : items.length - 1]?.focus()
  })
}

function handleMenuTriggerKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  menuOpen: boolean,
  onOpen: () => void,
  onClose: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    onClose()
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  event.stopPropagation()
  if (!menuOpen) onOpen()
  focusMenuEdge(event.currentTarget, event.key === 'ArrowDown' ? 'first' : 'last')
}

function handleMenuKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  onClose: () => void,
) {
  const menu = event.currentTarget
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))
  if (event.key === 'Escape') {
    const trigger = Array.from(document.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]'))
      .find((element) => element.getAttribute('aria-controls') === menu.id)
      || menu.parentElement?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
    event.preventDefault()
    event.stopPropagation()
    onClose()
    window.requestAnimationFrame(() => trigger?.focus())
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || items.length === 0) return
  event.preventDefault()
  event.stopPropagation()
  const currentIndex = items.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'Home') items[0]?.focus()
  else if (event.key === 'End') items[items.length - 1]?.focus()
  else if (event.key === 'ArrowDown') items[(currentIndex + 1 + items.length) % items.length]?.focus()
  else items[(currentIndex - 1 + items.length) % items.length]?.focus()
}

function generationRunning(project: WorkProject) {
  const status = project.novelPromotionData?.importStatus
  const episodeCount = project.novelPromotionData?.episodeCount ?? 0
  return episodeCount === 0
    && (status === 'pending' || status === 'queued' || status === 'running' || status === 'processing')
}

export interface ProjectActionHandlers {
  edit: (project: WorkProject) => void
  rename: (project: WorkProject) => void
  members: (project: WorkProject) => void
  move: (project: WorkProject, work: WorkSummary) => void
  delete: (project: WorkProject) => void
}

function ProjectCard({
  project,
  work,
  keyword,
  menuOpen,
  selectable,
  selected,
  index,
  onToggleMenu,
  onToggleSelected,
  actions,
}: {
  project: WorkProject
  work: WorkSummary
  keyword: string
  menuOpen: boolean
  selectable: boolean
  selected: boolean
  index: number
  onToggleMenu: () => void
  onToggleSelected: () => void
  actions: ProjectActionHandlers
}) {
  const { data: session } = useSession()
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const style = projectStyle(project)
  const genre = projectGenreLabel(project)
  const aspectRatio = projectAspectRatio(project)
  const collaborationLabel = ['Nori1.0', 'premium2'].includes(projectBudgetLevel(project))
    ? project.collaborationMode === 'team' ? '任务分工' : '自由协作'
    : null
  const canMove = canMoveFromWork(work) || project.canMove
  const canManage = Boolean(project.canManage) && isManagementRole(session?.user?.role)
  const canMembers = canManage || Boolean(project.canManageMembers)
  const running = generationRunning(project)
  const workbenchHref = `/workflow/${project.id}/workbench-premium2`
  const menuId = `project-actions-${project.id}`
  return (
    <article
      data-production-work-id={project.id}
      data-parent-project-id={work.id}
      className={`works-project-card${selected ? ' is-selected' : ''}${selectable ? ' is-selectable' : ''}`}
      onClick={selectable ? onToggleSelected : undefined}
      style={{ ...generativeCoverStyle(project.id), '--works-card-index': index + 1 } as CSSProperties}
    >
      {selectable ? (
        <button
          type="button"
          className={`works-project-check${selected ? ' is-on' : ''}`}
          aria-label={selected ? `取消选择 ${project.name}` : `选择 ${project.name}`}
          onClick={(event) => { event.stopPropagation(); onToggleSelected() }}
        >
          {selected ? <AppIcon name="check" className="h-3.5 w-3.5" /> : null}
        </button>
      ) : null}
      {running ? (
        <div className="works-project-running" aria-live="polite" data-testid="project-background-task-status">
          <AppIcon name="loader" className="h-6 w-6 animate-spin" />
          <p>AI 正在拆解剧集<br /><span>后台任务不影响进入作品</span></p>
          <Link href={{ pathname: workbenchHref }} className="works-project-running-enter">进入作品</Link>
        </div>
      ) : null}
      <Link
        href={{ pathname: workbenchHref }}
        className="works-project-main"
        tabIndex={selectable ? -1 : 0}
        onClick={(event) => { if (selectable) event.preventDefault() }}
      >
        <div className="works-project-cover nori-gen-cover">
          <span className={`works-project-edition${projectEditionTone(project)}${selectable ? ' with-select' : ''}`}>{projectEdition(project)}</span>
          <span className="works-project-monogram" aria-hidden="true">{coverMonogram(project.name)}</span>
        </div>
        <div className="works-project-info">
          <h3><Highlight text={project.name} keyword={keyword} /></h3>
          <div className="works-project-meta">
            <div className="works-project-tags">
              {collaborationLabel ? (
                <span className="is-collab"><AppIcon name={project.collaborationMode === 'team' ? 'usersRound' : 'link'} />{collaborationLabel}</span>
              ) : null}
              <span className="is-genre"><AppIcon name="film" />{genre}</span>
              {aspectRatio ? <span className="is-ratio"><AppIcon name="monitor" />{aspectRatio}</span> : null}
              {style ? <span className="is-style"><AppIcon name="sparkles" />{style}</span> : null}
            </div>
            <div className="works-project-footer">
              <span className="works-project-date"><AppIcon name="clock" />{formatDate(project.createdAt)} 创建</span>
              {selectable ? <span className="works-project-canvas-label"><AppIcon name="clapperboard" />无限画布</span> : null}
            </div>
          </div>
        </div>
      </Link>
      {!selectable ? (
        <Link
          href={{ pathname: `/workflow/${project.id}/workbench-premium2/canvas` }}
          className="works-project-canvas-entry"
          data-testid="project-card-canvas-entry"
          onClick={(event) => event.stopPropagation()}
        >
          <AppIcon name="clapperboard" />进入画布
        </Link>
      ) : null}
      {!selectable ? (
        <div
          className={`works-project-menu-wrap${menuOpen ? ' is-open' : ''}`}
        >
          <button
            ref={menuTrigger}
            type="button"
            className="works-more-button"
            aria-label={`打开 ${project.name} 菜单`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-controls={menuOpen ? menuId : undefined}
            onClick={(event) => { event.stopPropagation(); onToggleMenu() }}
            onKeyDown={(event) => handleMenuTriggerKeyDown(
              event,
              menuOpen,
              () => { if (!menuOpen) onToggleMenu() },
              () => { if (menuOpen) onToggleMenu() },
            )}
          >•••</button>
          {menuOpen ? (
            <ViewportPopover anchorRef={menuTrigger} width={184} onClose={onToggleMenu} className="fos-menu works-project-popover fos-viewport-theme">
            <div
              id={menuId}
              className="works-project-menu-items"
              role="menu"
              aria-label={`${project.name} 作品操作`}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => handleMenuKeyDown(event, onToggleMenu)}
            >
              <button type="button" role="menuitem" className="fos-menu-item" onClick={() => actions.edit(project)}><AppIcon name="settingsHex" />编辑作品</button>
              {canManage ? <button type="button" role="menuitem" className="fos-menu-item" onClick={() => actions.rename(project)}><AppIcon name="edit" />重命名</button> : null}
              {canMembers ? <button type="button" role="menuitem" className="fos-menu-item" onClick={() => actions.members(project)}><AppIcon name="usersRound" />{canManage ? '设置协作者' : '查看协作者'}</button> : null}
              {canMove ? <button type="button" role="menuitem" className="fos-menu-item" onClick={() => actions.move(project, work)}><AppIcon name="arrowRight" />移动到项目</button> : null}
              <Link role="menuitem" href={{ pathname: `/workflow/${project.id}/workbench-premium2/canvas` }} className="fos-menu-item" data-testid="project-card-canvas-menu-entry"><AppIcon name="clapperboard" />进入无限画布</Link>
              {canManage ? <button type="button" role="menuitem" className="fos-menu-item works-menu-danger" onClick={() => actions.delete(project)}><AppIcon name="trash" />删除作品</button> : null}
            </div>
            </ViewportPopover>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export interface WorkActionHandlers {
  createProject: (work: WorkSummary) => void
  rename: (work: WorkSummary) => void
  members: (work: WorkSummary) => void
  delete: (work: WorkSummary) => void
  moveSelected: (projects: WorkProject[], work: WorkSummary) => void
}

export function WorkPanel({
  work,
  keyword,
  activeMenuId,
  batchWorkId,
  selectedProjectIds,
  canCreateProjects,
  onMenuChange,
  onBatchWorkChange,
  onSelectedProjectIdsChange,
  workActions,
  projectActions,
}: {
  work: WorkSummary
  keyword: string
  activeMenuId: string | null
  batchWorkId: string | null
  selectedProjectIds: string[]
  canCreateProjects: boolean
  onMenuChange: (id: string | null) => void
  onBatchWorkChange: (id: string | null) => void
  onSelectedProjectIdsChange: (ids: string[]) => void
  workActions: WorkActionHandlers
  projectActions: ProjectActionHandlers
}) {
  const batch = batchWorkId === work.id
  const canMove = canMoveFromWork(work)
  const workMenuOpen = activeMenuId === `work:${work.id}`
  const canManage = Boolean(work.canManage)
  const workMenuId = `work-actions-${work.id}`
  const workMenuTrigger = useRef<HTMLButtonElement>(null)
  const exitBatch = () => {
    onBatchWorkChange(null)
    onSelectedProjectIdsChange([])
  }
  return (
    <section className="works-panel" data-project-id={work.id} data-work-id={work.id} aria-label={`项目 · ${work.name}`}>
      <header className="works-panel-header">
        <div className="works-panel-title">
          <span className="works-panel-badge">项目</span>
          <h2><Highlight text={work.name} keyword={keyword} /></h2>
        </div>
        <div className="works-panel-tools">
          {batch ? (
            <>
              <span className="works-batch-count">已选 <strong>{selectedProjectIds.length}</strong> 项</span>
              <div className="works-batch-tools">
                <button type="button" onClick={() => onSelectedProjectIdsChange(work.projects.map((project) => project.id))}>全选</button>
                <button type="button" disabled={selectedProjectIds.length === 0} onClick={() => onSelectedProjectIdsChange([])}>清空</button>
                <button className="is-primary" type="button" disabled={selectedProjectIds.length === 0} onClick={() => workActions.moveSelected(work.projects.filter((project) => selectedProjectIds.includes(project.id)), work)}><AppIcon name="arrowRight" />移动到项目</button>
                <button type="button" onClick={exitBatch}>退出</button>
              </div>
            </>
          ) : (
            <>
              <span><AppIcon name="fileFold" />{work.projectCount} 个作品</span>
              {!work.virtual ? <span><AppIcon name="clock" />{formatDate(work.createdAt)} 创建</span> : null}
              {!work.virtual && canCreateProjects ? (
                <button type="button" className="works-new-project" onClick={() => workActions.createProject(work)}><AppIcon name="plus" />新建作品</button>
              ) : null}
              {work.virtual && canMove && work.projects.length ? (
                <button type="button" className="works-new-project" onClick={() => { onBatchWorkChange(work.id); onSelectedProjectIdsChange([]) }}><AppIcon name="arrowRight" />批量移动作品</button>
              ) : null}
              {!work.virtual && (canManage || canMove) ? (
                <div className="relative">
                  <button
                    ref={workMenuTrigger}
                    type="button"
                    className="works-panel-more"
                    onClick={(event) => { event.stopPropagation(); onMenuChange(workMenuOpen ? null : `work:${work.id}`) }}
                    onKeyDown={(event) => handleMenuTriggerKeyDown(
                      event,
                      workMenuOpen,
                      () => onMenuChange(`work:${work.id}`),
                      () => onMenuChange(null),
                    )}
                    aria-label={`打开 ${work.name} 菜单`}
                    aria-expanded={workMenuOpen}
                    aria-haspopup="menu"
                    aria-controls={workMenuOpen ? workMenuId : undefined}
                  >•••</button>
                  {workMenuOpen ? (
                    <ViewportPopover
                      anchorRef={workMenuTrigger}
                      width={184}
                      onClose={() => onMenuChange(null)}
                      className="fos-menu works-project-popover fos-viewport-theme"
                    >
                    <div
                      id={workMenuId}
                      className="works-project-menu-items"
                      role="menu"
                      aria-label={`${work.name} 项目操作`}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => handleMenuKeyDown(event, () => onMenuChange(null))}
                    >
                      {!work.virtual ? <button type="button" role="menuitem" className="fos-menu-item" onClick={() => workActions.members(work)}><AppIcon name="usersRound" />{canManage ? '设置成员' : '查看成员'}</button> : null}
                      {canManage && !work.virtual ? <button type="button" role="menuitem" className="fos-menu-item" onClick={() => workActions.rename(work)}><AppIcon name="edit" />重命名</button> : null}
                      {canMove && work.projects.length ? <button type="button" role="menuitem" className="fos-menu-item" onClick={() => { onBatchWorkChange(work.id); onSelectedProjectIdsChange([]); onMenuChange(null) }}><AppIcon name="arrowRight" />批量移动作品</button> : null}
                      {canManage && !work.virtual ? (
                        <button type="button" role="menuitem" className="fos-menu-item works-menu-danger" disabled={work.projectCount > 0 || !work.canDelete} title={work.projectCount > 0 || !work.canDelete ? '请先移动或处理项目内作品（含回收站）' : undefined} onClick={() => workActions.delete(work)}><AppIcon name="trash" />删除项目</button>
                      ) : null}
                    </div>
                    </ViewportPopover>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </header>
      <div className={`works-project-body${work.projects.length === 0 ? ' is-empty' : ''}`}>
        {work.projects.length === 0 ? <div className="works-panel-empty">暂无作品</div> : (
          <div className="works-project-grid">
            {work.projects.map((project, index) => (
              <ProjectCard
                key={project.id}
                project={project}
                work={work}
                keyword={keyword}
                menuOpen={activeMenuId === `project:${project.id}`}
                selectable={batch}
                selected={selectedProjectIds.includes(project.id)}
                index={index}
                onToggleMenu={() => onMenuChange(activeMenuId === `project:${project.id}` ? null : `project:${project.id}`)}
                onToggleSelected={() => onSelectedProjectIdsChange(selectedProjectIds.includes(project.id)
                  ? selectedProjectIds.filter((id) => id !== project.id)
                  : [...selectedProjectIds, project.id])}
                actions={projectActions}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export function canCreateInsideWork(work: WorkSummary) {
  return work.id !== UNASSIGNED_WORK_ID && !work.virtual
}
