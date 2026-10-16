'use client'

import { useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Link, useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { FosProjectModelConfigDialog } from './FosProjectModelConfigDialog'
import { FosProjectAssignmentsDialog } from './FosProjectAssignmentsDialog'
import { isManagementRole } from '@/lib/account/permissions'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { notifyProjectChanged } from '@/lib/projects/change-client'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import { ConfirmActionDialog, RenameDialog } from './works/FosWorksDialogs'

export function FosProjectHeader({
  projectId,
  projectName,
  parentProjectName,
  title,
  backTo,
  backLabel,
  projectMetaTags = [],
}: {
  projectId: string
  projectName: string
  parentProjectName?: string | null
  title?: string
  backTo?: string
  backLabel?: string
  projectMetaTags?: string[]
}) {
  const { data: session } = useSession()
  const router = useRouter()
  const [modelConfigOpen, setModelConfigOpen] = useState(false)
  const [assignmentsOpen, setAssignmentsOpen] = useState(false)
  const canManage = isManagementRole(session?.user?.role)
  const actionTrigger = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [action, setAction] = useState<'rename' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mutate = async (name?: string) => {
    if (!canManage || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: name === undefined ? 'DELETE' : 'PATCH',
        ...(name === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, name === undefined ? '删除作品失败' : '重命名失败'))
      notifyProjectChanged(projectId)
      setAction(null)
      if (name === undefined) router.push({ pathname: '/projects' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '作品操作失败')
      throw cause
    } finally { setBusy(false) }
  }
  return (
    <>
    <div className="fos-stage-header">
      <Link
        href={backTo ?? `/workflow/${projectId}/workbench-premium2`}
        className="fos-back-btn"
        aria-label={backLabel || '返回上一级'}
        title={backLabel || '返回上一级'}
        data-testid="project-panel-back"
      >
        <AppIcon name="chevronLeft" className="h-4 w-4" />
        <span>{backLabel || '返回上一级'}</span>
      </Link>
      <div className="fos-stage-context flex min-w-0 flex-wrap items-center gap-2.5">
        {parentProjectName ? (
          <span className="text-[12px] text-[var(--fos-text-3)]" data-testid="work-parent-project">
            项目：{parentProjectName}<span aria-hidden="true"> / </span>
          </span>
        ) : null}
        <h1 className="text-[15px] font-bold text-white">{title ? `${title} · ${projectName}` : projectName}</h1>
        {projectMetaTags.map((tag) => (
          <span key={tag} className="fos-meta-tag">{tag}</span>
        ))}
      </div>
      <div className="fos-stage-actions ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="fos-btn fos-btn-soft fos-btn-sm"
          onClick={() => setAssignmentsOpen(true)}
          data-testid="project-assignments-entry"
        >
          <AppIcon name="user" className="h-3.5 w-3.5" />
          协作任务
        </button>
        <Link
          href={{ pathname: `/workflow/${projectId}/workbench-premium2/canvas` }}
          className="fos-btn fos-btn-soft fos-btn-sm"
          data-testid="project-stage-canvas-entry"
        >
          <AppIcon name="clapperboard" className="h-3.5 w-3.5" />
          无限画布
        </Link>
        <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => setModelConfigOpen(true)}><AppIcon name="settingsHex" className="h-3.5 w-3.5" />作品设置</button>
        {canManage ? <button ref={actionTrigger} type="button" className="fos-btn fos-btn-soft fos-btn-sm" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>作品操作<AppIcon name="chevronDown" className="h-3.5 w-3.5" /></button> : null}
        {canManage && menuOpen ? <ViewportPopover anchorRef={actionTrigger} width={184} onClose={() => setMenuOpen(false)} className="fos-menu works-project-popover fos-viewport-theme" role="menu" aria-label="作品操作">
          <button role="menuitem" className="fos-menu-item" onClick={() => { setMenuOpen(false); setModelConfigOpen(true) }}><AppIcon name="edit" />编辑作品</button>
          <button role="menuitem" className="fos-menu-item" onClick={() => { setMenuOpen(false); setAction('rename') }}><AppIcon name="edit" />重命名</button>
          <button role="menuitem" className="fos-menu-item works-menu-danger" onClick={() => { setMenuOpen(false); setAction('delete') }}><AppIcon name="trash" />删除作品</button>
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
    {action === 'rename' && canManage ? <RenameDialog kind="作品" initialName={projectName} busy={busy} onClose={() => setAction(null)} onSave={mutate} /> : null}
    {action === 'delete' && canManage ? <ConfirmActionDialog title="删除作品" description={`确定删除「${projectName}」吗？作品会移入回收站，15 天内可恢复。${error ? ` ${error}` : ''}`} confirmLabel="确认删除" danger busy={busy} onClose={() => setAction(null)} onConfirm={() => mutate()} /> : null}
    </>
  )
}
