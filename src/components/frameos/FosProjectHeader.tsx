'use client'

import { useRef, useState } from 'react'
import { Link, useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { FosProjectModelConfigDialog } from './FosProjectModelConfigDialog'
import { FosProjectAssignmentsDialog } from './FosProjectAssignmentsDialog'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { notifyProjectChanged } from '@/lib/projects/change-client'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import { ConfirmActionDialog } from './works/FosWorksDialogs'
import { projectLinkProps } from '@/lib/projects/navigation'

export function FosProjectHeader({
  projectId,
  projectName,
  parentProjectId,
  parentProjectName,
  canDelete = false,
  title,
  backTo,
  backLabel,
  projectMetaTags = [],
}: {
  projectId: string
  projectName: string
  parentProjectId?: string | null
  parentProjectName?: string | null
  canDelete?: boolean
  title?: string
  backTo?: string
  backLabel?: string
  projectMetaTags?: string[]
}) {
  const router = useRouter()
  const [modelConfigOpen, setModelConfigOpen] = useState(false)
  const [assignmentsOpen, setAssignmentsOpen] = useState(false)
  const actionTrigger = useRef<HTMLButtonElement>(null)
  const moreTrigger = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [action, setAction] = useState<'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mutate = async () => {
    if (!canDelete || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '删除作品失败'))
      notifyProjectChanged(projectId)
      setAction(null)
      router.push(parentProjectId ? projectLinkProps(parentProjectId) : { pathname: '/projects' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '作品操作失败')
      throw cause
    } finally { setBusy(false) }
  }
  const fullTitle = title ? `${title} · ${projectName}` : projectName
  const openModelConfig = () => { setMoreMenuOpen(false); setModelConfigOpen(true) }
  const openAssignments = () => { setMoreMenuOpen(false); setAssignmentsOpen(true) }
  return (
    <>
    <div className="fos-stage-header">
      <Link
        href={backTo ?? (parentProjectId ? projectLinkProps(parentProjectId) : { pathname: '/projects' })}
        className="fos-back-btn"
        aria-label={backLabel || '返回上一级'}
        title={backLabel || '返回上一级'}
        data-testid="project-panel-back"
      >
        <AppIcon name="chevronLeft" className="h-4 w-4" />
        <span>{backLabel || '返回上一级'}</span>
      </Link>
      <div className="fos-stage-context">
        {parentProjectName ? (
          <Link href={parentProjectId ? projectLinkProps(parentProjectId) : { pathname: '/projects' }} className="fos-stage-parent-project" data-testid="work-parent-project">
            <span>项目</span>{parentProjectName}
          </Link>
        ) : null}
        <h1 className="text-[15px] font-bold text-white" title={fullTitle}>{fullTitle}</h1>
        {projectMetaTags.map((tag) => (
          <span key={tag} className="fos-meta-tag">{tag}</span>
        ))}
      </div>
      <div className="fos-stage-actions">
        <button
          type="button"
          className="fos-btn fos-btn-soft fos-stage-icon-btn fos-stage-action-assignments"
          aria-label="协作任务"
          title="协作任务"
          onClick={openAssignments}
          data-testid="project-assignments-entry"
        >
          <AppIcon name="user" className="h-3.5 w-3.5" />
          <span className="fos-stage-action-label">协作任务</span>
        </button>
        <Link
          href={{ pathname: `/workflow/${projectId}/workbench-premium2/canvas` }}
          className="fos-btn fos-btn-soft fos-stage-icon-btn fos-stage-action-canvas"
          aria-label="无限画布"
          title="无限画布"
          data-testid="project-stage-canvas-entry"
        >
          <AppIcon name="clapperboard" className="h-3.5 w-3.5" />
          <span className="fos-stage-action-label">无限画布</span>
        </Link>
        <button
          type="button"
          className="fos-btn fos-btn-ghost fos-stage-icon-btn fos-stage-action-settings"
          aria-label="作品设置"
          title="作品设置"
          onClick={openModelConfig}
        >
          <AppIcon name="settingsHex" className="h-3.5 w-3.5" />
          <span className="fos-stage-action-label">作品设置</span>
        </button>
        {canDelete ? <button ref={actionTrigger} type="button" className="fos-btn fos-btn-soft fos-stage-action-more-legacy" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>作品操作<AppIcon name="chevronDown" className="h-3.5 w-3.5" /></button> : null}
        <button
          ref={moreTrigger}
          type="button"
          className="fos-btn fos-btn-soft fos-stage-more"
          aria-label="更多"
          title="更多"
          aria-haspopup="menu"
          aria-expanded={moreMenuOpen}
          onClick={() => setMoreMenuOpen((open) => !open)}
          data-testid="project-more-actions"
        >
          更多<AppIcon name="chevronDown" className="h-3.5 w-3.5" />
        </button>
        {canDelete && menuOpen ? <ViewportPopover anchorRef={actionTrigger} width={184} onClose={() => setMenuOpen(false)} className="fos-menu works-project-popover fos-viewport-theme" role="menu" aria-label="作品操作">
          <button role="menuitem" className="fos-menu-item" onClick={openModelConfig}><AppIcon name="edit" />编辑作品</button>
          <button role="menuitem" className="fos-menu-item works-menu-danger" onClick={() => { setMenuOpen(false); setAction('delete') }}><AppIcon name="trash" />删除作品</button>
        </ViewportPopover> : null}
        {moreMenuOpen ? <ViewportPopover anchorRef={moreTrigger} width={184} onClose={() => setMoreMenuOpen(false)} className="fos-menu works-project-popover fos-viewport-theme" role="menu" aria-label="更多操作">
          <button role="menuitem" className="fos-menu-item" onClick={openAssignments}><AppIcon name="user" />协作任务</button>
          <button role="menuitem" className="fos-menu-item" onClick={openModelConfig}><AppIcon name="settingsHex" />作品设置</button>
          {canDelete ? <button role="menuitem" className="fos-menu-item" onClick={openModelConfig}><AppIcon name="edit" />编辑作品</button> : null}
          {canDelete ? <button role="menuitem" className="fos-menu-item works-menu-danger" onClick={() => { setMoreMenuOpen(false); setAction('delete') }}><AppIcon name="trash" />删除作品</button> : null}
        </ViewportPopover> : null}
      </div>
      <FosProjectModelConfigDialog projectId={projectId} open={modelConfigOpen} onClose={() => setModelConfigOpen(false)} />
      <FosProjectAssignmentsDialog
        projectId={projectId}
        projectName={projectName}
        open={assignmentsOpen}
        onClose={() => setAssignmentsOpen(false)}
      />
    </div>
    {action === 'delete' && canDelete ? <ConfirmActionDialog title="删除作品" description={`确定删除「${projectName}」吗？作品会移入回收站，15 天内可恢复。${error ? ` ${error}` : ''}`} confirmLabel="确认删除" danger busy={busy} onClose={() => setAction(null)} onConfirm={() => mutate()} /> : null}
    </>
  )
}
