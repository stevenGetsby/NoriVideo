'use client'

import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons'
import {
  assignmentAssigneeLabel,
  assignmentEpisodeLabel,
  assignmentNavigateLabel,
  assignmentNavigationBlockReason,
  assignmentStageDisplayLabel,
  assignmentSubmitLabel,
  formatAssignmentDate,
  getAssignmentTimeColumns,
  type AssignmentStage,
  type AssignmentTab,
  type CollaborationAssignment,
} from './assignments-view-model'
import { AssignmentReviewNote, AssignmentStatusChip, type AssignmentReviewMode } from './FosAssignmentControls'

type TableAction = 'submit' | 'mark-complete'

const STAGE_ICONS: Record<AssignmentStage, AppIconName> = {
  script: 'fileText',
  asset: 'sparkles',
  storyboard: 'film',
  video: 'video',
}

function buildPaginationItems(current: number, total: number): Array<number | 'ellipsis-left' | 'ellipsis-right'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const pages = new Set([1, total, current - 1, current, current + 1])
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b)
  const result: Array<number | 'ellipsis-left' | 'ellipsis-right'> = []
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1]
    if (previous && page - previous > 1) result.push(previous === 1 ? 'ellipsis-left' : 'ellipsis-right')
    result.push(page)
  })
  return result
}

export function FosAssignmentsTable({
  assignments,
  activeTab,
  total,
  currentPage,
  pageSize,
  loading,
  error,
  actionId,
  navigationId,
  onSelect,
  onNavigate,
  onAction,
  onReview,
  onRetry,
  onPageChange,
}: {
  assignments: CollaborationAssignment[]
  activeTab: AssignmentTab
  total: number
  currentPage: number
  pageSize: number
  loading: boolean
  error: string | null
  actionId: string | null
  navigationId: string | null
  onSelect: (assignment: CollaborationAssignment) => void
  onNavigate: (assignment: CollaborationAssignment) => void
  onAction: (action: TableAction, assignment: CollaborationAssignment) => void
  onReview: (assignment: CollaborationAssignment, mode: AssignmentReviewMode) => void
  onRetry: () => void
  onPageChange: (page: number) => void
}) {
  const timeColumns = getAssignmentTimeColumns(activeTab)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const emptyText = activeTab === 'pending_review' ? '暂无待审核任务' : '暂无任务'

  const handleRowKeyboard = (event: ReactKeyboardEvent<HTMLTableRowElement>, assignment: CollaborationAssignment) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onSelect(assignment)
  }

  return (
    <div
      id={`assignment-panel-${activeTab}`}
      className="fa-tab-panel"
      role="tabpanel"
      aria-labelledby={`assignment-tab-${activeTab}`}
      tabIndex={0}
    >
      <div className="fa-table-wrap">
        <table className={`fa-table${timeColumns.length > 1 ? ' has-double-time' : ''}`}>
          <colgroup>
            <col className="fa-col-task" />
            <col className="fa-col-status" />
            <col className="fa-col-assignee" />
            {timeColumns.map((column) => <col className="fa-col-time" key={column.field} />)}
            <col className="fa-col-note" />
            <col className="fa-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th className="is-left">任务</th>
              <th>状态</th>
              <th>负责人</th>
              {timeColumns.map((column) => <th key={column.field}>{column.label}</th>)}
              <th>操作备注</th>
              <th className="is-right is-sticky">操作</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((assignment) => {
              const blocked = assignmentNavigationBlockReason(assignment)
              return (
                <tr
                  className="fa-task-row"
                  key={assignment.id}
                  tabIndex={0}
                  onClick={() => onSelect(assignment)}
                  onKeyDown={(event) => handleRowKeyboard(event, assignment)}
                >
                  <td className="is-left">
                    <div className="fa-task-cell">
                      <span className="fa-stage-badge"><AppIcon name={STAGE_ICONS[assignment.stage]} className="h-[11px] w-[11px]" />{assignmentStageDisplayLabel(assignment)}</span>
                      <div className="fa-task-names">
                        <strong>{assignment.workName || '未归属项目'}</strong>
                        <AppIcon name="chevronRight" className="h-[11px] w-[11px]" />
                        <span>{assignment.projectName || assignment.projectId}</span>
                        {assignmentEpisodeLabel(assignment) ? <><AppIcon name="chevronRight" className="h-[11px] w-[11px]" /><em>{assignmentEpisodeLabel(assignment)}</em></> : null}
                      </div>
                    </div>
                  </td>
                  <td><AssignmentStatusChip status={assignment.status} /></td>
                  <td><span className="fa-assignee"><AppIcon name="user" className="h-[11px] w-[11px]" />{assignmentAssigneeLabel(assignment)}</span></td>
                  {timeColumns.map((column) => <td key={column.field}><span className="fa-time-cell">{formatAssignmentDate(assignment[column.field])}</span></td>)}
                  <td><div className="fa-note-cell"><AssignmentReviewNote assignment={assignment} /></div></td>
                  <td className="is-right is-sticky" onClick={(event) => event.stopPropagation()}>
                    <div className="fa-row-actions">
                      {assignment.canSubmit ? (
                        <button
                          type="button"
                          className="fa-action-button is-primary"
                          disabled={Boolean(actionId)}
                          onClick={() => onAction('submit', assignment)}
                        >
                          {actionId === assignment.id ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" /> : null}
                          {assignmentSubmitLabel(assignment)}
                        </button>
                      ) : null}
                      {assignment.canMarkComplete && !assignment.canSubmit ? (
                        <button
                          type="button"
                          className="fa-action-button is-primary"
                          disabled={Boolean(actionId)}
                          onClick={() => onAction('mark-complete', assignment)}
                        >
                          {actionId === assignment.id ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" /> : null}
                          标记完成
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="fa-action-button"
                        disabled={Boolean(blocked) || Boolean(navigationId)}
                        title={blocked}
                        onClick={() => onNavigate(assignment)}
                      >
                        {navigationId === assignment.id ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" /> : null}
                        {navigationId === assignment.id ? '校验中' : assignmentNavigateLabel(assignment)}
                      </button>
                      {activeTab === 'pending_review' && assignment.canReview && assignment.stage !== 'video' && assignment.stage !== 'storyboard' ? (
                        <>
                          <button type="button" className="fa-action-button is-success" disabled={Boolean(actionId)} onClick={() => onReview(assignment, 'approve')}>通过</button>
                          <button type="button" className="fa-action-button is-danger" disabled={Boolean(actionId)} onClick={() => onReview(assignment, 'reject')}>驳回</button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {!loading && !error && assignments.length === 0 ? (
          <div className="fa-empty">
            <AppIcon name="clipboardCheckSolid" className="fa-empty-icon" />
            <p>{emptyText}</p>
          </div>
        ) : null}
        {error ? (
          <div className="fa-error-state" role="alert">
            <AppIcon name="alert" className="h-7 w-7" />
            <p>{error}</p>
            <button type="button" className="fa-action-button" onClick={onRetry}>重新加载</button>
          </div>
        ) : null}
        {loading ? (
          <div className="fa-loading-mask" role="status" aria-label="加载任务中">
            <AppIcon name="loader" className="fa-loading-spinner animate-spin" />
          </div>
        ) : null}
      </div>

      {total > 0 ? (
        <nav className="fa-pagination" aria-label="任务分页">
          <span>共 {total} 条</span>
          <button type="button" aria-label="上一页" disabled={currentPage <= 1 || loading} onClick={() => onPageChange(currentPage - 1)}>
            <AppIcon name="chevronLeft" className="h-4 w-4" />
          </button>
          {buildPaginationItems(currentPage, totalPages).map((item) => typeof item === 'number' ? (
            <button
              type="button"
              aria-current={item === currentPage ? 'page' : undefined}
              className={item === currentPage ? 'is-current' : ''}
              key={item}
              disabled={loading}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ) : <span className="fa-pagination-ellipsis" key={item}>…</span>)}
          <button type="button" aria-label="下一页" disabled={currentPage >= totalPages || loading} onClick={() => onPageChange(currentPage + 1)}>
            <AppIcon name="chevronRight" className="h-4 w-4" />
          </button>
        </nav>
      ) : null}
    </div>
  )
}
