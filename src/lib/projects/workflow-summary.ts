export const PROJECT_WORKFLOW_STAGE_KEYS = ['config', 'script', 'storyboard', 'videos', 'voice', 'editor'] as const

export type ProjectWorkflowStageKey = (typeof PROJECT_WORKFLOW_STAGE_KEYS)[number]
export type ProjectWorkflowSummaryStatus = 'draft' | 'ready' | 'running' | 'blocked' | 'review' | 'stale'

export interface ProjectWorkflowStats {
  episodes?: number | null
  panels?: number | null
  images?: number | null
  videos?: number | null
}

export interface ProjectWorkflowStageRow {
  stageKey: string
  scopeId?: string | null
  status?: string | null
  progress?: number | null
  reviewState?: string | null
  blocker?: string | null
  errorMessage?: string | null
  updatedAt?: Date | string | null
  approvedAt?: Date | string | null
}

export interface ProjectWorkflowSummary {
  source: 'workflow-stage-state'
  currentStage: ProjectWorkflowStageKey
  status: ProjectWorkflowSummaryStatus
  progress: number
  activeTaskCount: number
  activeStages: ProjectWorkflowStageKey[]
  blockedStages: ProjectWorkflowStageKey[]
  reviewStages: ProjectWorkflowStageKey[]
  staleStages: ProjectWorkflowStageKey[]
  approvedStages: ProjectWorkflowStageKey[]
  blocker: string | null
  updatedAt: string | null
}

interface BaselineSummary {
  currentStage: ProjectWorkflowStageKey
  status: ProjectWorkflowSummaryStatus
  progress: number
}

const STAGE_RANK = new Map<ProjectWorkflowStageKey, number>(
  PROJECT_WORKFLOW_STAGE_KEYS.map((stageKey, index) => [stageKey, index]),
)

const STAGE_KEY_SET = new Set<string>(PROJECT_WORKFLOW_STAGE_KEYS)

function isProjectWorkflowStageKey(value: string): value is ProjectWorkflowStageKey {
  return STAGE_KEY_SET.has(value)
}

function normalizeCount(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function clampProgress(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function rowTime(row: ProjectWorkflowStageRow) {
  const value = row.updatedAt
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toIso(value: Date | string | null | undefined) {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function sortStageKeys(values: Iterable<ProjectWorkflowStageKey>) {
  return Array.from(new Set(values)).sort((left, right) => (
    (STAGE_RANK.get(left) ?? 0) - (STAGE_RANK.get(right) ?? 0)
  ))
}

function pickLatest(rows: ProjectWorkflowStageRow[]) {
  return [...rows].sort((left, right) => {
    const timeDiff = rowTime(right) - rowTime(left)
    if (timeDiff !== 0) return timeDiff
    return (STAGE_RANK.get(right.stageKey as ProjectWorkflowStageKey) ?? 0)
      - (STAGE_RANK.get(left.stageKey as ProjectWorkflowStageKey) ?? 0)
  })[0] ?? null
}

export function buildProjectWorkflowBaseline(stats: ProjectWorkflowStats): BaselineSummary {
  const episodes = normalizeCount(stats.episodes)
  const panels = normalizeCount(stats.panels)
  const images = normalizeCount(stats.images)
  const videos = normalizeCount(stats.videos)

  if (episodes === 0 && panels === 0 && images === 0 && videos === 0) {
    return { currentStage: 'config', status: 'draft', progress: 0 }
  }

  if (panels === 0) {
    return { currentStage: 'script', status: 'ready', progress: 25 }
  }

  if (videos === 0) {
    const imageRatio = panels > 0 ? Math.min(images / panels, 1) : 0
    return { currentStage: 'storyboard', status: 'ready', progress: 45 + Math.round(imageRatio * 15) }
  }

  if (panels === 0 || videos < panels) {
    const videoRatio = panels > 0 ? Math.min(videos / panels, 1) : 1
    return { currentStage: 'videos', status: 'ready', progress: 65 + Math.round(videoRatio * 20) }
  }

  return { currentStage: 'editor', status: 'ready', progress: 90 }
}

export function buildProjectWorkflowSummary(input: {
  stats: ProjectWorkflowStats
  stages?: ProjectWorkflowStageRow[]
  activeTaskCount?: number
}): ProjectWorkflowSummary {
  const baseline = buildProjectWorkflowBaseline(input.stats)
  const rows = (input.stages || []).filter((row): row is ProjectWorkflowStageRow & { stageKey: ProjectWorkflowStageKey } => (
    isProjectWorkflowStageKey(row.stageKey)
  ))
  const activeTaskCount = Math.max(0, Math.round(input.activeTaskCount || 0))

  const activeRows = rows.filter((row) => row.status === 'queued' || row.status === 'running')
  const blockedRows = rows.filter((row) => (
    row.status === 'failed'
    || row.status === 'canceled'
    || Boolean(row.blocker)
    || Boolean(row.errorMessage)
  ))
  const staleRows = rows.filter((row) => row.status === 'stale' || row.reviewState === 'stale')
  const reviewRows = rows.filter((row) => row.status === 'pending_review' || row.reviewState === 'review')
  const approvedRows = rows.filter((row) => (
    row.status === 'approved'
    || row.reviewState === 'confirmed'
    || Boolean(row.approvedAt)
  ))

  const activeStages = sortStageKeys(activeRows.map((row) => row.stageKey))
  const blockedStages = sortStageKeys(blockedRows.map((row) => row.stageKey))
  const staleStages = sortStageKeys(staleRows.map((row) => row.stageKey))
  const reviewStages = sortStageKeys(reviewRows.map((row) => row.stageKey))
  const approvedStages = sortStageKeys(approvedRows.map((row) => row.stageKey))

  const latestRow = pickLatest(rows)
  let selectedRow: ProjectWorkflowStageRow | null = null
  let status = baseline.status

  if (activeRows.length > 0) {
    selectedRow = pickLatest(activeRows)
    status = 'running'
  } else if (blockedRows.length > 0) {
    selectedRow = pickLatest(blockedRows)
    status = 'blocked'
  } else if (staleRows.length > 0) {
    selectedRow = pickLatest(staleRows)
    status = 'stale'
  } else if (reviewRows.length > 0) {
    selectedRow = pickLatest(reviewRows)
    status = 'review'
  } else if (activeTaskCount > 0) {
    status = 'running'
  }

  const currentStage: ProjectWorkflowStageKey = selectedRow && isProjectWorkflowStageKey(selectedRow.stageKey)
    ? selectedRow.stageKey
    : baseline.currentStage
  const selectedProgress = typeof selectedRow?.progress === 'number' ? selectedRow.progress : null
  const progress = status === 'running'
    ? Math.max(baseline.progress, clampProgress(selectedProgress ?? baseline.progress))
    : clampProgress(selectedProgress ?? baseline.progress)

  return {
    source: 'workflow-stage-state',
    currentStage,
    status,
    progress,
    activeTaskCount,
    activeStages,
    blockedStages,
    reviewStages,
    staleStages,
    approvedStages,
    blocker: selectedRow?.blocker || selectedRow?.errorMessage || null,
    updatedAt: toIso(latestRow?.updatedAt),
  }
}
