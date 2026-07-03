import { getScreenwriterRouteByStage, getScreenwriterStageRoute } from './routes'
import {
  SCREENWRITER_TASK_KIND,
  VIDEO_REPAINT_STAGE,
  VIDEO_REPAINT_STAGE_STATUS,
  type EpisodeProcessDto,
  type EpisodeProcessStatus,
  type ScreenwriterTaskKind,
  type ScreenwriterTaskStatus,
  type ScreenwriterTaskSummaryDto,
  type SettingsReviewDto,
  type TargetScriptEpisodeDto,
  type VideoRepaintRouteStage,
  type VideoRepaintStageItemDto,
  type VideoRepaintStageKey,
  type VideoRepaintStageStatus,
  type VideoRepaintTaskDetailDto,
} from './types'

type StageRow = {
  stageKey: string
  title: string
  subtitle: string
  status: string
  checkpoint?: string | null
}

type TaskSummaryRow = {
  id: string
  title: string
  taskKind: string
  status: string
  activeTaskLabel?: string | null
  currentStage?: string | null
  currentStageStatus?: string | null
  episodeCount: number
  updatedAt?: Date | string | null
}

type SettingsReviewRow = {
  stageKey: string
  checkpoint: string
  outlineTitle: string
  bodySections: unknown
  collapsedPanelTitle: string
  nameIndexGroups?: unknown
  mappingGroups?: unknown
  issues?: unknown
  feedbackPlaceholder: string
}

type EpisodeProcessRow = {
  id: string
  stageKey: string
  episodeNumber: number
  status: string
  errorMessage?: string | null
}

type ScriptEpisodeRow = {
  id: string
  episodeNumber: number
  title: string
  status: string
  wordCount?: number | null
  content: string
}

type TaskDetailRow = TaskSummaryRow & {
  requirement: string
  transferForm: string
  stageStates?: StageRow[]
  settingsReviews?: SettingsReviewRow[]
  episodeProcesses?: EpisodeProcessRow[]
  scriptEpisodes?: ScriptEpisodeRow[]
}

const TASK_LABEL_BY_KIND: Record<ScreenwriterTaskKind, string> = {
  video_repaint_2: '视频转绘2.0任务',
  script_repaint_2: '剧本转绘2.0任务',
  storyboard_repaint_2: '分镜转绘2.0任务',
}

const TASK_TYPE_LABEL_BY_TRANSFER_FORM: Record<string, string> = {
  script: '剧本转绘 2.0',
  board: '分镜转绘 2.0',
}

const EMPTY_REVIEW_BY_STAGE: Record<'source_settings' | 'target_settings', SettingsReviewDto> = {
  source_settings: {
    title: '源设定检查点',
    checkpoint: 'A',
    outlineTitle: '源设定总纲',
    bodySections: [],
    collapsedPanelTitle: '统一名索引',
    collapsedPanelCount: 0,
    nameIndexGroups: [],
    issuePanelTitle: '复核问题',
    issueCount: 0,
    issues: [],
    feedbackPlaceholder: '补充需要重新提炼的要求',
  },
  target_settings: {
    title: '目标设定检查点',
    checkpoint: 'B',
    outlineTitle: '目标设定总纲',
    bodySections: [],
    collapsedPanelTitle: '映射关系',
    collapsedPanelCount: 0,
    nameIndexGroups: [],
    issuePanelTitle: '复核问题',
    issueCount: 0,
    issues: [],
    feedbackPlaceholder: '补充需要重新生成的要求',
  },
}

function iso(value: Date | string | null | undefined) {
  if (!value) return undefined
  return value instanceof Date ? value.toISOString() : value
}

function isTaskKind(value: string): value is ScreenwriterTaskKind {
  return Object.values(SCREENWRITER_TASK_KIND).includes(value as ScreenwriterTaskKind)
}

function isStageKey(value: string): value is VideoRepaintStageKey {
  return Object.values(VIDEO_REPAINT_STAGE).includes(value as VideoRepaintStageKey)
}

function isRouteStage(value: string): value is VideoRepaintRouteStage {
  return isStageKey(value) || value === 'target_script'
}

function isStageStatus(value: string): value is VideoRepaintStageStatus {
  return Object.values(VIDEO_REPAINT_STAGE_STATUS).includes(value as VideoRepaintStageStatus)
}

function normalizeCurrentStage(value: string | null | undefined): VideoRepaintRouteStage {
  return value && isRouteStage(value) ? value : VIDEO_REPAINT_STAGE.AUTO_SPLIT
}

function normalizeStageStatus(value: string | null | undefined): VideoRepaintStageStatus {
  return value && isStageStatus(value) ? value : VIDEO_REPAINT_STAGE_STATUS.NOT_STARTED
}

function normalizeTaskKind(value: string): ScreenwriterTaskKind {
  return isTaskKind(value) ? value : SCREENWRITER_TASK_KIND.VIDEO_REPAINT_2
}

export function toScreenwriterTaskSummary(row: TaskSummaryRow): ScreenwriterTaskSummaryDto {
  const taskKind = normalizeTaskKind(row.taskKind)
  const currentStage = normalizeCurrentStage(row.currentStage)
  const currentStageStatus = normalizeStageStatus(row.currentStageStatus)
  return {
    id: row.id,
    title: row.title,
    episodeCount: row.episodeCount,
    taskKind,
    taskLabel: TASK_LABEL_BY_KIND[taskKind],
    status: row.status as ScreenwriterTaskStatus,
    activeTaskId: row.id,
    activeTaskLabel: row.activeTaskLabel || undefined,
    activeTaskStatus: currentStageStatus,
    currentStage,
    currentStageStatus,
    nextRoute: getScreenwriterStageRoute(taskKind, row.id, currentStage),
    updatedAt: iso(row.updatedAt),
  }
}

function toStageItem(row: StageRow): VideoRepaintStageItemDto | null {
  if (!isStageKey(row.stageKey)) return null
  return {
    key: row.stageKey,
    title: row.title,
    subtitle: row.subtitle,
    status: normalizeStageStatus(row.status),
    checkpoint: row.checkpoint === 'A' || row.checkpoint === 'B' ? row.checkpoint : undefined,
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function toReview(row: SettingsReviewRow | undefined, fallbackKey: 'source_settings' | 'target_settings'): SettingsReviewDto {
  if (!row) return EMPTY_REVIEW_BY_STAGE[fallbackKey]
  const checkpoint = row.checkpoint === 'B' ? 'B' : 'A'
  const nameIndexGroups = asArray<SettingsReviewDto['nameIndexGroups'][number]>(
    fallbackKey === 'target_settings' ? row.mappingGroups ?? row.nameIndexGroups : row.nameIndexGroups,
  )
  const issues = asArray<SettingsReviewDto['issues'][number]>(row.issues)
  return {
    title: checkpoint === 'A' ? '源设定检查点' : '目标设定检查点',
    checkpoint,
    outlineTitle: row.outlineTitle,
    bodySections: asArray<SettingsReviewDto['bodySections'][number]>(row.bodySections),
    collapsedPanelTitle: row.collapsedPanelTitle,
    collapsedPanelCount: nameIndexGroups.reduce((sum, group) => sum + group.rows.length, 0),
    nameIndexGroups,
    issuePanelTitle: '复核问题',
    issueCount: issues.length,
    issues,
    feedbackPlaceholder: row.feedbackPlaceholder,
  }
}

function toEpisode(row: EpisodeProcessRow): EpisodeProcessDto {
  return {
    id: row.id,
    episodeNumber: row.episodeNumber,
    status: row.status as EpisodeProcessStatus,
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
  }
}

export function toTargetScriptEpisode(row: ScriptEpisodeRow): TargetScriptEpisodeDto {
  return {
    id: row.id,
    episodeNumber: row.episodeNumber,
    title: row.title,
    status: row.status as EpisodeProcessStatus,
    wordCount: row.wordCount ?? countWords(row.content),
    content: row.content,
  }
}

export function countWords(content: string): number {
  const trimmed = content.trim()
  if (!trimmed) return 0
  const cjk = trimmed.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const latin = trimmed.replace(/[\u4e00-\u9fff]/g, ' ').trim().split(/\s+/).filter(Boolean).length
  return cjk + latin
}

export function toVideoRepaintTaskDetail(row: TaskDetailRow): VideoRepaintTaskDetailDto {
  const taskKind = normalizeTaskKind(row.taskKind)
  const stages = (row.stageStates || []).map(toStageItem).filter((item): item is VideoRepaintStageItemDto => !!item)
  const currentStage = normalizeCurrentStage(row.currentStage)
  const detailStage: VideoRepaintStageKey = currentStage === 'target_script' ? VIDEO_REPAINT_STAGE.EPISODE_REPAINT : currentStage
  const sourceSettings = toReview(
    (row.settingsReviews || []).filter((item) => item.stageKey === 'source_settings').at(-1),
    'source_settings',
  )
  const targetSettings = toReview(
    (row.settingsReviews || []).filter((item) => item.stageKey === 'target_settings').at(-1),
    'target_settings',
  )

  return {
    id: row.id,
    title: row.title,
    taskTypeLabel: taskKind === SCREENWRITER_TASK_KIND.SCRIPT_REPAINT_2
      ? '剧本转绘 2.0'
      : TASK_TYPE_LABEL_BY_TRANSFER_FORM[row.transferForm] || '视频转绘 2.0',
    requirement: row.requirement,
    currentStage: detailStage,
    stages,
    sourceSettings,
    targetSettings,
    alignmentEpisodes: (row.episodeProcesses || []).filter((item) => item.stageKey === 'episode_alignment').map(toEpisode),
    repaintEpisodes: (row.episodeProcesses || []).filter((item) => item.stageKey === 'episode_repaint').map(toEpisode),
    routeByStage: getScreenwriterRouteByStage(taskKind, row.id),
    canConfirmCurrentStage: currentStage === 'source_settings' || currentStage === 'target_settings',
    canRetryCurrentStage: stages.some((stage) => stage.status === 'failed' || stage.status === 'stale'),
  }
}
