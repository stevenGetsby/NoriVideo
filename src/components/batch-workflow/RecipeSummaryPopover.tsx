'use client'

import type { RefObject } from 'react'
import { ViewportPopover } from '@/components/ui/viewport-popover'
import type { WorkflowSkillDTO } from '@/lib/batch-workflow/types'

export function RecipeSummaryPopover({
  skill,
  anchorRef,
  onClose,
}: {
  skill: WorkflowSkillDTO | null
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  return (
    <ViewportPopover
      anchorRef={anchorRef}
      onClose={onClose}
      width={348}
      maxHeight={320}
      className="wf-popover"
      lockAnchorWhileOpen
      role="dialog"
      aria-label="配方摘要"
    >
      <div className="wf-popover-head">
        <span>{skill ? `${skill.name} v${skill.version}` : '当前配方'}</span>
        {skill?.isBuiltin ? <span className="wf-badge is-muted">内置配方</span> : null}
      </div>
      <div className="wf-popover-body">
        {skill ? (
          <>
            <div className="wf-popover-item-title">用途</div>
            <div className="wf-popover-item-desc" style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
              {skill.description || '暂无配方用途说明。'}
            </div>
            <div className="wf-popover-item-title">更新说明</div>
            <div className="wf-popover-item-desc" style={{ whiteSpace: 'pre-wrap' }}>
              {skill.changeNote || '暂无版本更新说明。'}
            </div>
            <div className="wf-field-hint" style={{ marginTop: 10 }}>
              更新时间：{new Date(skill.updatedAt).toLocaleString('zh-CN')}
            </div>
          </>
        ) : (
          <div className="wf-dock-readonly">当前阶段尚未绑定配方。</div>
        )}
      </div>
    </ViewportPopover>
  )
}
