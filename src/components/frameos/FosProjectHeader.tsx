'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { FosProjectModelConfigDialog } from './FosProjectModelConfigDialog'
import { FosProjectAssignmentsDialog } from './FosProjectAssignmentsDialog'

const META_TAGS = ['剧情模式', '9:16', '480x856', '仿真人']

export function FosProjectHeader({
  projectId,
  projectName,
  title,
  backTo,
  backLabel,
}: {
  projectId: string
  projectName: string
  title?: string
  backTo?: string
  backLabel?: string
}) {
  const { data: session } = useSession()
  const [modelConfigOpen, setModelConfigOpen] = useState(false)
  const [assignmentsOpen, setAssignmentsOpen] = useState(false)
  const canManage = session?.user?.role === 'admin' || session?.user?.role === 'super_admin'
  return (
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
        <h1 className="text-[15px] font-bold text-white">{title ? `${title} · ${projectName}` : projectName}</h1>
        {META_TAGS.map((tag) => (
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
        {canManage ? <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => setModelConfigOpen(true)}><AppIcon name="settingsHex" className="h-3.5 w-3.5" />模型配置</button> : null}
      </div>
      <FosProjectModelConfigDialog projectId={projectId} open={modelConfigOpen} onClose={() => setModelConfigOpen(false)} />
      <FosProjectAssignmentsDialog
        projectId={projectId}
        projectName={projectName}
        open={assignmentsOpen}
        onClose={() => setAssignmentsOpen(false)}
      />
    </div>
  )
}
