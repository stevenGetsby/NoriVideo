export type AssignmentTab = 'todo' | 'in_review' | 'done' | 'pending_review'

export type AssignmentStage = 'script' | 'asset' | 'storyboard' | 'video'

export type AssignmentStatus =
  | 'unassigned'
  | 'in_progress'
  | 'pending_review'
  | 'completed'
  | 'rejected'

export interface CollaborationAssignment {
  id: string
  scopeId?: string | null
  projectId: string
  projectName: string
  workId?: string | null
  workName?: string | null
  stage: AssignmentStage
  status: AssignmentStatus
  assigneeUserId?: string | null
  assigneeName?: string | null
  assigneeDisabled?: boolean
  assigneeKind?: 'owner' | 'subaccount' | string | null
  episodeId?: string | null
  episodeNumber?: number | null
  assignedAt?: string | null
  submittedAt?: string | null
  completedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  lastReviewNote?: string | null
  matched?: boolean
  canAssign?: boolean
  canSubmit?: boolean
  canMarkComplete?: boolean
  canReview?: boolean
  canReopen?: boolean
  submitCompletesDirectly?: boolean
}

export interface CollaborationAssignmentEvent {
  id: string
  eventType: string
  fromStatus?: AssignmentStatus | string | null
  toStatus?: AssignmentStatus | string | null
  note?: string | null
  payload?: unknown
  createdAt?: string | null
  actorUserId?: string | null
  actorName?: string | null
  actorRole?: string | null
  actorDisabled?: boolean
}

export interface VideoReviewAnnotationDraft {
  id: string
  panelId?: string | null
  startMs: number
  endMs: number
  note: string
}

export interface VideoReviewAnnotationRecord extends Omit<VideoReviewAnnotationDraft, 'id'> {
  id: string
  status: 'open' | 'resolved' | string
  resolvedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface VideoReviewSource {
  id: string
  kind?: 'episode' | 'segment'
  clipId?: string | null
  panelId?: string | null
  label: string
  storyboardId?: string
  sequence?: number
  sceneLabel?: string
  segmentLabel?: string
  description?: string | null
  sourceText?: string | null
  videoPrompt?: string | null
  location?: string | null
  shotType?: string | null
  cameraMove?: string | null
  characters?: string[]
  props?: string[]
  imageUrl?: string | null
  videoUrl?: string | null
  startMs: number
  endMs: number
  durationMs: number
  trimStartMs?: number
  trimEndMs?: number
  virtualSequence?: boolean
}

export interface VideoReviewContext {
  assignment: {
    id: string
    projectId: string
    projectName?: string | null
    workName?: string | null
    episodeId?: string | null
    episodeNumber?: number | null
    episodeName?: string | null
    status: AssignmentStatus
    submittedAt?: string | null
    lastReviewNote?: string | null
    canAnnotate?: boolean
    canRespond?: boolean
  }
  submissionCapturedAt?: string | null
  reviewTarget?: {
    kind: 'canvas_playlist'
    canvasId: string
    nodeId: string
    title: string
  } | null
  sources: VideoReviewSource[]
  durationMs: number
  totalPanelCount?: number
  readyPanelCount?: number
  activeVideoTaskCount?: number
  readyForReview?: boolean
  annotations: VideoReviewAnnotationRecord[]
}

export function formatVideoReviewTimecode(value: number): string {
  const totalMs = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  const minutes = Math.floor(totalMs / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1_000)
  const tenths = Math.floor((totalMs % 1_000) / 100)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

export interface AssignmentCounts {
  todo: number
  inReview: number
  done: number
  pendingReview: number
}

export interface AssignmentBatchFailure {
  assignmentId: string
  error: string
}

export interface AssignmentBatchSummary {
  total: number
  okCount: number
  failedCount: number
  failures: AssignmentBatchFailure[]
  contractMismatch: boolean
}

export interface AssignmentTimeColumn {
  field: 'assignedAt' | 'submittedAt' | 'completedAt'
  label: string
}

export const ASSIGNMENT_TABS: ReadonlyArray<{ key: AssignmentTab; label: string }> = [
  { key: 'todo', label: '待我处理' },
  { key: 'in_review', label: '审核中' },
  { key: 'done', label: '已完成' },
  { key: 'pending_review', label: '待我审核' },
]

export const ASSIGNMENT_STAGE_LABELS: Record<AssignmentStage, string> = {
  script: '剧本解析',
  asset: '资产设定',
  storyboard: '分镜设计',
  video: '视频制作',
}

export const ASSIGNMENT_STATUS_META: Record<AssignmentStatus, { label: string; tone: string }> = {
  unassigned: { label: '待分配', tone: 'unassigned' },
  in_progress: { label: '进行中', tone: 'assigned' },
  pending_review: { label: '待审核', tone: 'pending-review' },
  completed: { label: '已完成', tone: 'approved' },
  rejected: { label: '已驳回', tone: 'rejected' },
}

export function isAssignmentTab(value: string | null | undefined): value is AssignmentTab {
  return ASSIGNMENT_TABS.some((tab) => tab.key === value)
}

export function getAssignmentTimeColumns(tab: AssignmentTab): AssignmentTimeColumn[] {
  if (tab === 'done') {
    return [
      { field: 'completedAt', label: '完成时间' },
      { field: 'submittedAt', label: '提交时间' },
    ]
  }
  if (tab === 'in_review' || tab === 'pending_review') {
    return [{ field: 'submittedAt', label: '提交时间' }]
  }
  return [{ field: 'assignedAt', label: '分配时间' }]
}

export function formatAssignmentDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  })
}

export function assignmentTaskLabel(assignment: CollaborationAssignment): string {
  const stage = assignmentStageDisplayLabel(assignment)
  if (isCanvasPlaylistAssignment(assignment)) return stage
  if (assignment.stage === 'script' || assignment.stage === 'asset') return stage
  return `${stage}·第 ${assignment.episodeNumber ?? '?'} 集`
}

export function assignmentStageDisplayLabel(assignment: CollaborationAssignment): string {
  if (isCanvasPlaylistAssignment(assignment)) {
    return assignment.status === 'pending_review' && assignment.canReview ? '播放列表最终审核' : '播放列表剪辑'
  }
  if (assignment.status === 'pending_review' && assignment.canReview && assignment.stage === 'video') {
    return '本集视频审核'
  }
  return ASSIGNMENT_STAGE_LABELS[assignment.stage]
}

export function assignmentEpisodeLabel(assignment: CollaborationAssignment): string {
  if (isCanvasPlaylistAssignment(assignment)) return '画布播放列表'
  if (assignment.stage === 'script' || assignment.stage === 'asset' || assignment.episodeNumber == null) return ''
  return `第${assignment.episodeNumber}集`
}

export function assignmentAssigneeLabel(assignment: CollaborationAssignment): string {
  if (assignment.status === 'unassigned' && !assignment.assigneeUserId && !assignment.assigneeName) {
    return '待分配'
  }
  const name = assignment.assigneeName || assignment.assigneeUserId
  if (!name) return '待分配'
  const prefix = assignment.assigneeKind === 'owner' || name === '主账号' ? '主账号' : `子账号 · ${name}`
  return assignment.assigneeDisabled ? `${prefix} (已禁用)` : prefix
}

export function assignmentDrawerAssigneeLabel(assignment: CollaborationAssignment): string {
  const name = assignment.assigneeName || assignment.assigneeUserId || '未分配'
  return assignment.assigneeDisabled ? `${name} (已禁用)` : name
}

export function assignmentSubmitLabel(assignment: CollaborationAssignment): string {
  if (assignment.submitCompletesDirectly) return '标记完成'
  return assignment.status === 'rejected' ? '重新提交' : '提交审核'
}

export function assignmentNavigateLabel(assignment: CollaborationAssignment): string {
  if (isCanvasPlaylistAssignment(assignment)) {
    if (assignment.status === 'pending_review' && assignment.canReview) return '审核播放列表'
    return assignment.status === 'in_progress' || assignment.status === 'rejected' ? '进入播放列表剪辑' : '查看播放列表'
  }
  if (assignment.stage === 'video' && assignment.status === 'pending_review' && assignment.canReview) {
    return '审核本集视频'
  }
  if (assignment.stage === 'video') return assignment.canSubmit ? '进入视频制作' : '查看视频制作'
  if (assignment.stage === 'storyboard' && (assignment.status === 'completed' || assignment.status === 'pending_review')) {
    return '查看分镜'
  }
  return assignment.status === 'completed' || assignment.status === 'pending_review' ? '查看' : '去完成'
}

export function assignmentReviewNote(assignment: CollaborationAssignment): string {
  const note = assignment.lastReviewNote?.trim() ?? ''
  if (!note || (assignment.status !== 'rejected' && assignment.status !== 'completed')) return ''
  return note
}

export function assignmentDestination(assignment: CollaborationAssignment): string {
  if (assignment.status === 'pending_review' && assignment.canReview && assignment.stage === 'video') {
    return `/my-assignments/${assignment.id}/video-review`
  }
  const base = `/workflow/${assignment.projectId}/workbench-premium2`
  const playlistTarget = canvasPlaylistAssignmentTarget(assignment)
  if (playlistTarget) return `${base}/canvas/${encodeURIComponent(playlistTarget.canvasId)}`
  if (assignment.stage === 'script') return `${base}/script-review`
  if (assignment.stage === 'asset') return base
  if (assignment.stage === 'storyboard') return `${base}/storyboard`
  return `${base}/production/shot`
}

export function isCanvasPlaylistAssignment(assignment: Pick<CollaborationAssignment, 'scopeId' | 'stage'>) {
  return assignment.stage === 'video' && typeof assignment.scopeId === 'string' && assignment.scopeId.startsWith('canvas-playlist:')
}

export function canvasPlaylistAssignmentTarget(assignment: Pick<CollaborationAssignment, 'scopeId' | 'stage'>) {
  if (!isCanvasPlaylistAssignment(assignment)) return null
  const value = assignment.scopeId!.slice('canvas-playlist:'.length)
  const separator = value.indexOf(':')
  if (separator <= 0 || separator >= value.length - 1) return null
  return { canvasId: value.slice(0, separator), nodeId: value.slice(separator + 1) }
}

export function assignmentNavigationQuery(
  assignment: CollaborationAssignment,
  fromTab: AssignmentTab,
  resolvedEpisodeId?: string | null,
): Record<string, string> {
  const episodeId = resolvedEpisodeId?.trim() || assignment.episodeId
  const playlistTarget = canvasPlaylistAssignmentTarget(assignment)
  return {
    from: 'my-assignments',
    from_tab: fromTab,
    ...(playlistTarget ? { node_id: playlistTarget.nodeId } : {}),
    ...(assignment.stage !== 'script' && assignment.stage !== 'asset' && episodeId
      ? { episode_id: episodeId }
      : {}),
  }
}

export function assignmentSourceTab(assignment: CollaborationAssignment): AssignmentTab {
  if (assignment.status === 'completed') return 'done'
  if (assignment.status === 'pending_review') {
    return assignment.canReview ? 'pending_review' : 'in_review'
  }
  return 'todo'
}

export function assignmentReturnPath(
  from: string | null | undefined,
  fromTab: string | null | undefined,
): string | null {
  if (from !== 'my-assignments') return null
  const tab: AssignmentTab = isAssignmentTab(fromTab) ? fromTab : 'todo'
  return `/my-assignments?tab=${encodeURIComponent(tab)}`
}

export function assignmentNavigationBlockReason(assignment: CollaborationAssignment): string {
  if (!assignment.projectId) return '该任务所属作品不存在，暂无法进入'
  if (assignment.matched === false) return '该任务对应分集已不存在，暂无法进入'
  return ''
}

export function assignmentCountForTab(counts: AssignmentCounts, tab: AssignmentTab): number {
  if (tab === 'in_review') return counts.inReview
  if (tab === 'pending_review') return counts.pendingReview
  return counts[tab]
}

function finiteAssignmentCount(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

export function assignmentAttentionCount(counts: Pick<AssignmentCounts, 'todo' | 'pendingReview'>): number {
  return finiteAssignmentCount(counts.todo) + finiteAssignmentCount(counts.pendingReview)
}

export function resolveDefaultAssignmentTab(input: {
  routeTab?: string | null
  role?: string | null
  showPendingReviewTab?: boolean
  pendingReviewCount?: number
}): AssignmentTab {
  if (isAssignmentTab(input.routeTab)) return input.routeTab
  if (input.showPendingReviewTab === false) return 'todo'
  if (input.role === 'reviewer') return 'pending_review'
  if (input.showPendingReviewTab === true && finiteAssignmentCount(input.pendingReviewCount) > 0) {
    return 'pending_review'
  }
  return 'todo'
}

export function moveAssignmentFilterOptionIndex(
  currentIndex: number,
  optionCount: number,
  direction: 1 | -1,
): number {
  if (!Number.isInteger(optionCount) || optionCount <= 0) return 0
  const normalized = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < optionCount
    ? currentIndex
    : direction > 0 ? -1 : 0
  return (normalized + direction + optionCount) % optionCount
}

export function shouldDeferAssignmentFilterActivationToNestedButton(
  key: string,
  target: unknown,
  currentTarget: unknown,
): boolean {
  if ((key !== 'Enter' && key !== ' ') || target === currentTarget || !target || typeof target !== 'object') {
    return false
  }
  const tagName = 'tagName' in target ? (target as { tagName?: unknown }).tagName : undefined
  return typeof tagName === 'string' && tagName.toUpperCase() === 'BUTTON'
}

export function moveAssignmentTabIndex(
  currentIndex: number,
  tabCount: number,
  key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
): number {
  if (!Number.isInteger(tabCount) || tabCount <= 0) return 0
  if (key === 'Home') return 0
  if (key === 'End') return tabCount - 1
  const normalized = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < tabCount
    ? currentIndex
    : 0
  const direction = key === 'ArrowRight' ? 1 : -1
  return (normalized + direction + tabCount) % tabCount
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * Batch endpoints are deliberately partial-success. Treat the per-assignment
 * results as authoritative for retry selection, while checking the aggregate
 * total/okCount contract so a malformed response can never be shown as full
 * success.
 */
export function summarizeAssignmentBatchResult(
  payload: unknown,
  requestedAssignmentIds: string[],
): AssignmentBatchSummary {
  const requestedIds = Array.from(new Set(requestedAssignmentIds.map((id) => id.trim()).filter(Boolean)))
  const response = payload && typeof payload === 'object'
    ? payload as { results?: unknown; total?: unknown; okCount?: unknown }
    : {}
  const rawResults = Array.isArray(response.results) ? response.results : []
  const resultById = new Map<string, { ok: boolean; error?: string }>()

  for (const item of rawResults) {
    if (!item || typeof item !== 'object') continue
    const result = item as { assignmentId?: unknown; ok?: unknown; error?: unknown }
    const assignmentId = typeof result.assignmentId === 'string' ? result.assignmentId.trim() : ''
    if (!assignmentId || resultById.has(assignmentId)) continue
    resultById.set(assignmentId, {
      ok: result.ok === true,
      ...(typeof result.error === 'string' && result.error.trim()
        ? { error: result.error.trim() }
        : {}),
    })
  }

  const failures: AssignmentBatchFailure[] = []
  let observedOkCount = 0
  for (const assignmentId of requestedIds) {
    const result = resultById.get(assignmentId)
    if (result?.ok) {
      observedOkCount += 1
      continue
    }
    failures.push({
      assignmentId,
      error: result?.error || (result ? '任务分配失败' : '服务端未返回该任务的处理结果'),
    })
  }

  const reportedTotal = readNonNegativeInteger(response.total)
  const reportedOkCount = readNonNegativeInteger(response.okCount)
  const total = requestedIds.length
  return {
    total,
    okCount: observedOkCount,
    failedCount: failures.length,
    failures,
    contractMismatch: reportedTotal !== total || reportedOkCount !== observedOkCount,
  }
}

const ASSIGNMENT_EVENT_LABELS: Record<string, string> = {
  created: '创建任务',
  assign: '分配任务',
  assigned: '分配任务',
  reassign: '重新分配',
  submit: '提交审核',
  resubmit: '重新提交',
  approve: '审核通过',
  reject: '驳回任务',
  'mark-complete': '标记完成',
  marked_complete: '标记完成',
  reopen: '恢复进行中',
  reopened: '恢复进行中',
}

export function assignmentEventLabel(event: Pick<CollaborationAssignmentEvent, 'eventType' | 'fromStatus'>): string {
  if (event.eventType === 'submit' && event.fromStatus === 'rejected') return '重新提交'
  return ASSIGNMENT_EVENT_LABELS[event.eventType] || event.eventType || '更新任务'
}
