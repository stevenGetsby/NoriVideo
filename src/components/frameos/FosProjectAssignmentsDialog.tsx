'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { logError } from '@/lib/logging/core'
import {
  ASSIGNMENT_STAGE_LABELS,
  ASSIGNMENT_STATUS_META,
  assignmentDestination,
  assignmentEpisodeLabel,
  assignmentNavigationQuery,
  assignmentNavigateLabel,
  assignmentSourceTab,
  summarizeAssignmentBatchResult,
  type AssignmentBatchSummary,
  type AssignmentStage,
  type AssignmentStatus,
  type CollaborationAssignment,
} from './assignments-view-model'
import { AssignmentStatusChip } from './FosAssignmentControls'

interface AssignmentCandidate {
  userId: string
  name: string
  role: string
  roleLabel?: string | null
  status: string
  isWorkspaceOwner?: boolean
  eligibleStages?: AssignmentStage[]
}

interface AssignmentOverviewResponse {
  assignments?: CollaborationAssignment[]
  canManageAssignments?: boolean
  canReviewAssignments?: boolean
}

interface AssignmentNavigationResponse {
  assignment?: { episodeId?: string | null }
}

const STAGES: AssignmentStage[] = ['script', 'asset', 'storyboard', 'video']
const STATUSES: AssignmentStatus[] = ['unassigned', 'in_progress', 'pending_review', 'rejected', 'completed']
const REQUEST_TIMEOUT_MS = 15_000

function candidateLabel(candidate: AssignmentCandidate) {
  if (candidate.isWorkspaceOwner) return `${candidate.name}（主账号）`
  return `${candidate.name}${candidate.roleLabel ? ` · ${candidate.roleLabel}` : ''}`
}

export function FosProjectAssignmentsDialog({
  projectId,
  projectName,
  open,
  onClose,
}: {
  projectId: string
  projectName: string
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [assignments, setAssignments] = useState<CollaborationAssignment[]>([])
  const [candidates, setCandidates] = useState<Record<AssignmentStage, AssignmentCandidate[]>>({
    script: [], asset: [], storyboard: [], video: [],
  })
  const [canManage, setCanManage] = useState(false)
  const [canReview, setCanReview] = useState(false)
  const [loading, setLoading] = useState(false)
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [batchSummary, setBatchSummary] = useState<AssignmentBatchSummary | null>(null)
  const [stageFilter, setStageFilter] = useState<AssignmentStage | ''>('')
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | ''>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assigneeByTask, setAssigneeByTask] = useState<Record<string, string>>({})
  const [bulkAssignee, setBulkAssignee] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [navigationId, setNavigationId] = useState<string | null>(null)

  const loadCandidates = useCallback(async (signal?: AbortSignal) => {
    setCandidatesLoading(true)
    try {
      const results = await Promise.all(STAGES.map(async (stage) => {
        const response = await apiFetch(`/api/collaboration/assignments/candidates?projectId=${encodeURIComponent(projectId)}&stage=${stage}`, {
          signal,
        })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, `加载${ASSIGNMENT_STAGE_LABELS[stage]}负责人失败`))
        const payload = await response.json() as { candidates?: AssignmentCandidate[] }
        return [stage, Array.isArray(payload.candidates) ? payload.candidates : []] as const
      }))
      if (!signal?.aborted) {
        setCandidates(Object.fromEntries(results) as Record<AssignmentStage, AssignmentCandidate[]>)
      }
      return !signal?.aborted
    } catch (candidateError) {
      if (signal?.aborted) return false
      logError('[FosProjectAssignmentsDialog] 加载负责人失败', candidateError)
      setError(candidateError instanceof Error ? candidateError.message : '加载负责人失败')
      return false
    } finally {
      if (!signal?.aborted) setCandidatesLoading(false)
    }
  }, [projectId])

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/list?projectId=${encodeURIComponent(projectId)}`, { signal })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载协作任务失败'))
      const payload = await response.json() as AssignmentOverviewResponse
      const rows = Array.isArray(payload.assignments) ? payload.assignments : []
      setAssignments(rows)
      setCanManage(payload.canManageAssignments === true)
      setCanReview(payload.canReviewAssignments === true)
      setAssigneeByTask(Object.fromEntries(rows.map((row) => [row.id, row.assigneeUserId || ''])))
      setSelected((current) => new Set([...current].filter((id) => rows.some((row) => row.id === id))))
      return payload.canManageAssignments === true
    } catch (loadError) {
      if (signal?.aborted) return false
      logError('[FosProjectAssignmentsDialog] 加载任务失败', loadError)
      setError(loadError instanceof Error ? loadError.message : '加载协作任务失败')
      return false
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setNotice(null)
    setBatchSummary(null)
    setSelected(new Set())
    setBulkAssignee('')
    setCandidates({ script: [], asset: [], storyboard: [], video: [] })
    setCandidatesLoading(false)
    void loadOverview(controller.signal).then(async (manageable) => {
      if (!manageable || controller.signal.aborted) return
      await loadCandidates(controller.signal)
    })
    return () => controller.abort()
  }, [loadCandidates, loadOverview, open, projectId])

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyId && !navigationId) onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [busyId, navigationId, onClose, open])

  const filteredAssignments = useMemo(() => assignments.filter((assignment) => (
    (!stageFilter || assignment.stage === stageFilter)
    && (!statusFilter || assignment.status === statusFilter)
  )), [assignments, stageFilter, statusFilter])

  const selectedAssignments = assignments.filter((assignment) => selected.has(assignment.id))
  const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment]))
  const selectedStage = selectedAssignments[0]?.stage || null
  const mixedSelection = selectedAssignments.some((assignment) => assignment.stage !== selectedStage)
  const bulkCandidates = selectedStage && !mixedSelection ? candidates[selectedStage] : []
  const selectableIds = filteredAssignments
    .filter((assignment) => assignment.canAssign)
    .map((assignment) => assignment.id)
  const allVisibleSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
  const interactionBusy = Boolean(busyId || navigationId)

  const retryLoad = async () => {
    const manageable = await loadOverview()
    if (manageable) await loadCandidates()
  }

  const mutate = async (endpoint: string, body: Record<string, unknown>, taskId: string, success: string) => {
    setBusyId(taskId)
    setError(null)
    setNotice(null)
    setBatchSummary(null)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '任务操作失败'))
      setNotice(success)
      await loadOverview()
    } catch (actionError) {
      logError('[FosProjectAssignmentsDialog] 任务操作失败', actionError)
      setError(actionError instanceof Error ? actionError.message : '任务操作失败')
    } finally {
      setBusyId(null)
    }
  }

  const toggleAllVisible = () => {
    setSelected((current) => {
      const next = new Set(current)
      if (allVisibleSelected) selectableIds.forEach((id) => next.delete(id))
      else selectableIds.forEach((id) => next.add(id))
      return next
    })
  }

  const handleBatchAssign = async () => {
    if (!bulkAssignee || !selectedAssignments.length || mixedSelection) return
    const assignmentIds = selectedAssignments.map((assignment) => assignment.id)
    setBusyId('__batch__')
    setError(null)
    setNotice(null)
    setBatchSummary(null)
    try {
      const response = await apiFetch('/api/collaboration/assignments/batch-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentIds, assigneeUserId: bulkAssignee }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '批量分配失败'))
      const summary = summarizeAssignmentBatchResult(await response.json(), assignmentIds)
      setBatchSummary(summary)
      if (summary.failedCount === 0 && !summary.contractMismatch) {
        setNotice(`已分配 ${summary.okCount} 个任务`)
        setSelected(new Set())
        setBulkAssignee('')
      } else if (summary.failedCount > 0) {
        setSelected(new Set(summary.failures.map((failure) => failure.assignmentId)))
      }
      await loadOverview()
    } catch (actionError) {
      logError('[FosProjectAssignmentsDialog] 批量分配失败', actionError)
      setError(actionError instanceof Error ? actionError.message : '批量分配失败')
    } finally {
      setBusyId(null)
    }
  }

  const navigateToAssignment = async (assignment: CollaborationAssignment) => {
    if (busyId || navigationId) return
    const intent = assignment.canSubmit
      ? 'work'
      : assignment.status === 'pending_review' && assignment.canReview ? 'review' : 'view'
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    setNavigationId(assignment.id)
    setError(null)
    setNotice(null)
    try {
      const response = await apiFetch(`/api/collaboration/assignments/${assignment.id}/navigation?intent=${intent}`, {
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '任务暂时无法进入'))
      const navigation = await response.json() as AssignmentNavigationResponse
      router.push({
        pathname: assignmentDestination(assignment),
        query: assignmentNavigationQuery(
          assignment,
          assignmentSourceTab(assignment),
          navigation.assignment?.episodeId,
        ),
      })
      onClose()
    } catch (navigationError) {
      const message = controller.signal.aborted
        ? '任务校验超时，请稍后重试。'
        : navigationError instanceof Error ? navigationError.message : '任务暂时无法进入'
      logError('[FosProjectAssignmentsDialog] 任务导航失败', navigationError)
      setError(message)
    } finally {
      window.clearTimeout(timeout)
      setNavigationId(null)
    }
  }

  if (!open) return null

  return (
    <div className="fpa-overlay" role="presentation" onMouseDown={() => { if (!interactionBusy) onClose() }}>
      <section className="fpa-dialog" role="dialog" aria-modal="true" aria-labelledby="fpa-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="fpa-head">
          <div>
            <h2 id="fpa-title">协作任务</h2>
            <p>{projectName} · 分配剧本、资产、分镜和视频制作负责人</p>
          </div>
          <button type="button" className="fa-dialog-close" aria-label="关闭协作任务" disabled={interactionBusy} onClick={onClose}>
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </header>

        <div className="fpa-toolbar">
          <label>任务类型
            <select value={stageFilter} onChange={(event) => { setStageFilter(event.target.value as AssignmentStage | ''); setSelected(new Set()) }}>
              <option value="">全部</option>
              {STAGES.map((stage) => <option value={stage} key={stage}>{ASSIGNMENT_STAGE_LABELS[stage]}</option>)}
            </select>
          </label>
          <label>状态
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as AssignmentStatus | ''); setSelected(new Set()) }}>
              <option value="">全部</option>
              {STATUSES.map((status) => <option value={status} key={status}>{ASSIGNMENT_STATUS_META[status].label}</option>)}
            </select>
          </label>
          <div className="fpa-summary">
            <span>{assignments.length} 个任务</span>
            <span>{assignments.filter((item) => item.status === 'completed').length} 个已完成</span>
          </div>
        </div>

        {canManage && selectedAssignments.length > 0 ? (
          <div className="fpa-batch">
            <span>已选择 {selectedAssignments.length} 个{mixedSelection ? '（请选择同一任务类型）' : ` ${selectedStage ? ASSIGNMENT_STAGE_LABELS[selectedStage] : ''}任务`}</span>
            <select value={bulkAssignee} disabled={mixedSelection || interactionBusy} onChange={(event) => setBulkAssignee(event.target.value)}>
              <option value="">选择负责人</option>
              {bulkCandidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidateLabel(candidate)}</option>)}
            </select>
            <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" disabled={!bulkAssignee || mixedSelection || interactionBusy} onClick={() => void handleBatchAssign()}>
              {busyId === '__batch__' ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" /> : null}批量分配
            </button>
          </div>
        ) : null}

        {notice ? <div className="fpa-notice is-success"><AppIcon name="check" className="h-3.5 w-3.5" />{notice}</div> : null}
        {batchSummary && (batchSummary.failedCount > 0 || batchSummary.contractMismatch) ? (
          <div className="fpa-batch-feedback" role="status">
            <div className="fpa-batch-feedback-head">
              <AppIcon name="alert" className="h-3.5 w-3.5" />
              <strong>批量分配完成：成功 {batchSummary.okCount}，失败 {batchSummary.failedCount}</strong>
            </div>
            {batchSummary.contractMismatch ? <p>服务端汇总与逐条结果不一致，已按逐条结果展示，请刷新后确认。</p> : null}
            {batchSummary.failures.length > 0 ? (
              <ul>
                {batchSummary.failures.map((failure) => {
                  const assignment = assignmentById.get(failure.assignmentId)
                  const taskLabel = assignment
                    ? `${ASSIGNMENT_STAGE_LABELS[assignment.stage]}${assignmentEpisodeLabel(assignment) ? ` · ${assignmentEpisodeLabel(assignment)}` : ''}`
                    : failure.assignmentId
                  return <li key={failure.assignmentId}><span>{taskLabel}</span><em>{failure.error}</em></li>
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
        {error ? <div className="fpa-notice is-error"><AppIcon name="alert" className="h-3.5 w-3.5" />{error}<button type="button" onClick={() => void retryLoad()}>重试</button></div> : null}

        <div className="fpa-table-wrap">
          <table className="fpa-table">
            <thead>
              <tr>
                {canManage ? <th className="fpa-select-col"><input type="checkbox" aria-label="选择当前筛选任务" checked={allVisibleSelected} disabled={!selectableIds.length} onChange={toggleAllVisible} /></th> : null}
                <th>任务</th><th>状态</th><th>当前负责人</th><th>分配负责人</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssignments.map((assignment) => {
                const selectedAssignee = assigneeByTask[assignment.id] || ''
                const sameAssignee = selectedAssignee === (assignment.assigneeUserId || '')
                const canSubmitAssignment = assignment.canAssign && selectedAssignee && !(sameAssignee && assignment.status === 'in_progress')
                return (
                  <tr key={assignment.id}>
                    {canManage ? <td className="fpa-select-col"><input type="checkbox" aria-label={`选择 ${ASSIGNMENT_STAGE_LABELS[assignment.stage]}${assignmentEpisodeLabel(assignment)}`} checked={selected.has(assignment.id)} disabled={!assignment.canAssign} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(assignment.id)) next.delete(assignment.id); else next.add(assignment.id); return next })} /></td> : null}
                    <td><strong>{ASSIGNMENT_STAGE_LABELS[assignment.stage]}</strong><span>{assignmentEpisodeLabel(assignment) || '项目级'}</span></td>
                    <td><AssignmentStatusChip status={assignment.status} compact /></td>
                    <td>{assignment.assigneeName || '待分配'}{assignment.assigneeDisabled ? <em>已停用</em> : null}</td>
                    <td>
                      {canManage && assignment.status !== 'completed' ? (
                        <select value={selectedAssignee} disabled={interactionBusy} onChange={(event) => setAssigneeByTask((current) => ({ ...current, [assignment.id]: event.target.value }))}>
                          <option value="">选择负责人</option>
                          {candidates[assignment.stage].map((candidate) => <option value={candidate.userId} key={candidate.userId}>{candidateLabel(candidate)}</option>)}
                        </select>
                      ) : <span className="fpa-muted">—</span>}
                    </td>
                    <td>
                      <div className="fpa-actions">
                        {canSubmitAssignment ? <button type="button" disabled={interactionBusy} onClick={() => void mutate('assign', { assignmentId: assignment.id, assigneeUserId: selectedAssignee }, assignment.id, '任务负责人已更新')}>{busyId === assignment.id ? <AppIcon name="loader" className="h-3 w-3 animate-spin" /> : null}{assignment.assigneeUserId ? '重新分配' : '分配'}</button> : null}
                        {assignment.canMarkComplete ? <button type="button" disabled={interactionBusy} onClick={() => void mutate('mark-complete', { assignmentId: assignment.id }, assignment.id, '任务已标记完成')}>完成</button> : null}
                        {assignment.canReopen ? <button type="button" disabled={interactionBusy} onClick={() => void mutate('reopen', { assignmentId: assignment.id }, assignment.id, '任务已恢复进行中')}>恢复</button> : null}
                        <button type="button" disabled={interactionBusy} onClick={() => void navigateToAssignment(assignment)}>
                          {navigationId === assignment.id ? <AppIcon name="loader" className="h-3 w-3 animate-spin" /> : null}
                          {navigationId === assignment.id ? '校验中' : assignmentNavigateLabel(assignment)}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {loading || candidatesLoading ? <div className="fpa-loading"><AppIcon name="loader" className="h-4 w-4 animate-spin" />加载协作任务…</div> : null}
          {!loading && !candidatesLoading && !error && filteredAssignments.length === 0 ? <div className="fpa-empty">当前筛选下暂无任务</div> : null}
        </div>

        <footer className="fpa-foot">
          <span>{canManage ? '你可以分配、重新分配和恢复任务。' : '当前为只读查看；任务分配由项目管理员处理。'}{canReview ? ' 你也拥有审核权限。' : ''}</span>
          <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={interactionBusy} onClick={onClose}>关闭</button>
        </footer>
      </section>
    </div>
  )
}
