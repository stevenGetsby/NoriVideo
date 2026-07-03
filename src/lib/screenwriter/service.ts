import { prisma } from '@/lib/prisma'
import { toScreenwriterTaskSummary, toTargetScriptEpisode, toVideoRepaintTaskDetail, countWords } from './dto'
import { getScriptRepaintTaskRoute, getVideoRepaintStageRoute, getVideoRepaintTaskRoute } from './routes'
import {
  SCREENWRITER_TASK_KIND,
  SCREENWRITER_TASK_STATUS,
  VIDEO_REPAINT_STAGE,
  VIDEO_REPAINT_STAGE_STATUS,
  type ScreenwriterTaskKind,
  type ScreenwriterTaskStatus,
  type ScriptRepaintCreateInput,
  type ScriptRepaintCreateResponse,
  type TargetScriptEpisodeDto,
  type VideoRepaintCreateInput,
  type VideoRepaintCreateResponse,
  type VideoRepaintRouteStage,
  type VideoRepaintStageKey,
  type VideoRepaintStageStatus,
  type VideoRepaintTaskDetailDto,
} from './types'

type JsonValue = unknown
type ScreenwriterClient = {
  $transaction: <T>(fn: (tx: ScreenwriterTx) => Promise<T>) => Promise<T>
  screenwriterTask: ScreenwriterTaskModel
  screenwriterStageState: ScreenwriterStageStateModel
  screenwriterSettingsReview: ScreenwriterSettingsReviewModel
  screenwriterReviewFeedback: ScreenwriterReviewFeedbackModel
  screenwriterScriptEpisode: ScreenwriterScriptEpisodeModel
  screenwriterArtifact: ScreenwriterArtifactModel
}

type ScreenwriterTx = Omit<ScreenwriterClient, '$transaction'>

type ScreenwriterTaskModel = {
  create: (args: unknown) => Promise<unknown>
  findMany: (args: unknown) => Promise<unknown[]>
  count: (args: unknown) => Promise<number>
  findFirst: (args: unknown) => Promise<unknown | null>
  update: (args: unknown) => Promise<unknown>
}

type ScreenwriterStageStateModel = {
  findFirst: (args: unknown) => Promise<unknown | null>
  update: (args: unknown) => Promise<unknown>
  updateMany: (args: unknown) => Promise<{ count: number }>
}

type ScreenwriterSettingsReviewModel = {
  findFirst: (args: unknown) => Promise<unknown | null>
  create: (args: unknown) => Promise<unknown>
  updateMany: (args: unknown) => Promise<{ count: number }>
  update: (args: unknown) => Promise<unknown>
}

type ScreenwriterReviewFeedbackModel = {
  create: (args: unknown) => Promise<unknown>
}

type ScreenwriterScriptEpisodeModel = {
  findMany: (args: unknown) => Promise<unknown[]>
  findFirst: (args: unknown) => Promise<unknown | null>
  update: (args: unknown) => Promise<unknown>
}

type ScreenwriterArtifactModel = {
  create: (args: unknown) => Promise<unknown>
  findFirst: (args: unknown) => Promise<unknown | null>
  update: (args: unknown) => Promise<unknown>
}

const client = prisma as unknown as ScreenwriterClient

const STAGE_DEFS: Array<{
  key: VideoRepaintStageKey
  title: string
  subtitle: string
  checkpoint?: 'A' | 'B'
}> = [
  { key: 'auto_split', title: '自动拆集', subtitle: '识别上传视频并整理为可处理的分集。' },
  { key: 'fact_extract', title: '事实卡提取', subtitle: '提取人物、场景、道具和剧情事实卡。' },
  { key: 'source_settings', title: '源设定', subtitle: '人工检查源设定总纲与统一名索引。', checkpoint: 'A' },
  { key: 'episode_alignment', title: '逐集对齐', subtitle: '按源设定对齐每一集的结构和称呼。' },
  { key: 'target_settings', title: '目标设定', subtitle: '人工检查目标设定与源目标映射。', checkpoint: 'B' },
  { key: 'episode_repaint', title: '逐集转绘', subtitle: '生成目标版本剧本文本。' },
]

const SCRIPT_REPAINT_STAGE_DEFS = STAGE_DEFS.filter((stage) => stage.key !== VIDEO_REPAINT_STAGE.EPISODE_ALIGNMENT).map((stage) => {
  if (stage.key === VIDEO_REPAINT_STAGE.AUTO_SPLIT) {
    return { ...stage, subtitle: '将源剧本文本拆分为可逐集处理的剧集。' }
  }
  return stage
})

const STAGE_ORDER: VideoRepaintRouteStage[] = [
  'auto_split',
  'fact_extract',
  'source_settings',
  'episode_alignment',
  'target_settings',
  'episode_repaint',
  'target_script',
]

const SCRIPT_REPAINT_STAGE_ORDER: VideoRepaintRouteStage[] = [
  'auto_split',
  'fact_extract',
  'source_settings',
  'target_settings',
  'episode_repaint',
  'target_script',
]

const DETAIL_INCLUDE = {
  stageStates: { orderBy: { createdAt: 'asc' } },
  sourceVideos: { orderBy: { episodeNumber: 'asc' } },
  settingsReviews: { orderBy: [{ stageKey: 'asc' }, { version: 'asc' }] },
  episodeProcesses: { orderBy: [{ stageKey: 'asc' }, { episodeNumber: 'asc' }] },
  scriptEpisodes: { orderBy: [{ episodeNumber: 'asc' }, { version: 'asc' }] },
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizePage(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value || 0)) return fallback
  return Math.max(1, Math.floor(value || fallback))
}

function normalizePageSize(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value || 0)) return fallback
  return Math.min(Math.max(Math.floor(value || fallback), 1), 100)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStage(value: string): VideoRepaintStageKey {
  if (Object.values(VIDEO_REPAINT_STAGE).includes(value as VideoRepaintStageKey)) {
    return value as VideoRepaintStageKey
  }
  throw new Error('INVALID_STAGE')
}

function normalizeStageStatus(value: string): VideoRepaintStageStatus {
  if (Object.values(VIDEO_REPAINT_STAGE_STATUS).includes(value as VideoRepaintStageStatus)) {
    return value as VideoRepaintStageStatus
  }
  return VIDEO_REPAINT_STAGE_STATUS.NOT_STARTED
}

function nextStageForTask(taskKind: string | undefined, stage: VideoRepaintRouteStage): VideoRepaintRouteStage | null {
  const order = taskKind === SCREENWRITER_TASK_KIND.SCRIPT_REPAINT_2 ? SCRIPT_REPAINT_STAGE_ORDER : STAGE_ORDER
  const index = order.indexOf(stage)
  if (index < 0 || index >= order.length - 1) return null
  return order[index + 1]
}

function buildWhere(params: {
  userId: string
  status?: ScreenwriterTaskStatus | null
  taskKind?: ScreenwriterTaskKind | null
  search?: string | null
}) {
  const search = params.search?.trim()
  return {
    userId: params.userId,
    ...(params.status ? { status: params.status } : {}),
    ...(params.taskKind ? { taskKind: params.taskKind } : {}),
    ...(search ? {
      OR: [
        { title: { contains: search } },
        { requirement: { contains: search } },
      ],
    } : {}),
  }
}

function createStageRows(startStatus: VideoRepaintStageStatus, checkpoints: Record<'A' | 'B', boolean>) {
  return STAGE_DEFS.map((stage) => ({
    stageKey: stage.key,
    title: stage.title,
    subtitle: stage.subtitle,
    status: stage.key === VIDEO_REPAINT_STAGE.AUTO_SPLIT ? startStatus : VIDEO_REPAINT_STAGE_STATUS.NOT_STARTED,
    checkpoint:
      stage.checkpoint && checkpoints[stage.checkpoint]
        ? stage.checkpoint
        : null,
    progress: stage.key === VIDEO_REPAINT_STAGE.AUTO_SPLIT ? 5 : 0,
  }))
}

function createScriptStageRows(startStatus: VideoRepaintStageStatus, checkpoints: Record<'A' | 'B', boolean>) {
  return SCRIPT_REPAINT_STAGE_DEFS.map((stage) => ({
    stageKey: stage.key,
    title: stage.title,
    subtitle: stage.subtitle,
    status: stage.key === VIDEO_REPAINT_STAGE.AUTO_SPLIT ? startStatus : VIDEO_REPAINT_STAGE_STATUS.NOT_STARTED,
    checkpoint:
      stage.checkpoint && checkpoints[stage.checkpoint]
        ? stage.checkpoint
        : null,
    progress: stage.key === VIDEO_REPAINT_STAGE.AUTO_SPLIT ? 5 : 0,
  }))
}

function toDetail(value: unknown): VideoRepaintTaskDetailDto {
  return toVideoRepaintTaskDetail(value as Parameters<typeof toVideoRepaintTaskDetail>[0])
}

export async function createVideoRepaintTask(input: VideoRepaintCreateInput): Promise<VideoRepaintCreateResponse> {
  const title = input.title.trim()
  const requirement = input.requirement.trim()
  const sourceAssetName = input.sourceAssetName.trim()
  if (!input.userId || !title || !requirement || !sourceAssetName) {
    throw new Error('INVALID_VIDEO_REPAINT_INPUT')
  }

  const episodeCount = input.uploadMode === 'folder' ? 12 : 1
  const created = await client.$transaction(async (tx) => {
    return await tx.screenwriterTask.create({
      data: {
        userId: input.userId,
        title,
        taskKind: SCREENWRITER_TASK_KIND.VIDEO_REPAINT_2,
        status: SCREENWRITER_TASK_STATUS.DRAFT,
        activeTaskLabel: '进行中',
        currentStage: VIDEO_REPAINT_STAGE.AUTO_SPLIT,
        currentStageStatus: VIDEO_REPAINT_STAGE_STATUS.RUNNING,
        episodeCount,
        requirement,
        transferForm: input.transferForm,
        uploadMode: input.uploadMode,
        checkpointConfig: input.checkpoints as unknown as JsonValue,
        sourceVideos: {
          create: [
            {
              episodeNumber: 1,
              fileName: sourceAssetName,
              uploadStatus: 'local',
            },
          ],
        },
        stageStates: {
          create: createStageRows(VIDEO_REPAINT_STAGE_STATUS.RUNNING, input.checkpoints),
        },
      },
      include: DETAIL_INCLUDE,
    })
  })

  const row = toObject(created)
  return {
    id: String(row.id),
    title: String(row.title),
    nextRoute: getVideoRepaintTaskRoute(String(row.id)),
  }
}

export async function createScriptRepaintTask(input: ScriptRepaintCreateInput): Promise<ScriptRepaintCreateResponse> {
  const title = input.title.trim()
  const requirement = input.requirement.trim()
  const sourceScriptText = input.sourceScriptText.trim()
  if (!input.userId || !title || !requirement || !sourceScriptText) {
    throw new Error('INVALID_SCRIPT_REPAINT_INPUT')
  }

  const created = await client.$transaction(async (tx) => {
    return await tx.screenwriterTask.create({
      data: {
        userId: input.userId,
        title,
        taskKind: SCREENWRITER_TASK_KIND.SCRIPT_REPAINT_2,
        status: SCREENWRITER_TASK_STATUS.DRAFT,
        activeTaskLabel: '进行中',
        currentStage: VIDEO_REPAINT_STAGE.AUTO_SPLIT,
        currentStageStatus: VIDEO_REPAINT_STAGE_STATUS.RUNNING,
        episodeCount: 1,
        requirement,
        transferForm: 'script',
        uploadMode: input.sourceInputMode,
        checkpointConfig: input.checkpoints as unknown as JsonValue,
        stageStates: {
          create: createScriptStageRows(VIDEO_REPAINT_STAGE_STATUS.RUNNING, input.checkpoints),
        },
        artifacts: {
          create: [
            {
              stageKey: VIDEO_REPAINT_STAGE.AUTO_SPLIT,
              artifactType: 'source_script_raw',
              refId: 'source-script',
              payload: {
                sourceInputMode: input.sourceInputMode,
                sourceScriptName: input.sourceScriptName || null,
                sourceScriptText,
              } as unknown as JsonValue,
              version: 1,
            },
          ],
        },
      },
      include: DETAIL_INCLUDE,
    })
  })

  const row = toObject(created)
  return {
    id: String(row.id),
    title: String(row.title),
    nextRoute: getScriptRepaintTaskRoute(String(row.id)),
  }
}

export async function listScreenwriterTasks(params: {
  userId: string
  status?: ScreenwriterTaskStatus | null
  taskKind?: ScreenwriterTaskKind | null
  search?: string | null
  page?: number
  pageSize?: number
}) {
  const page = normalizePage(params.page, 1)
  const pageSize = normalizePageSize(params.pageSize, 50)
  const where = buildWhere(params)
  const [total, rows] = await Promise.all([
    client.screenwriterTask.count({ where }),
    client.screenwriterTask.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return {
    tasks: rows.map((row) => toScreenwriterTaskSummary(row as Parameters<typeof toScreenwriterTaskSummary>[0])),
    total,
    page,
    pageSize,
  }
}

export async function getVideoRepaintTaskDetail(params: {
  userId: string
  taskId: string
}): Promise<VideoRepaintTaskDetailDto | null> {
  const row = await client.screenwriterTask.findFirst({
    where: {
      id: params.taskId,
      userId: params.userId,
    },
    include: DETAIL_INCLUDE,
  })
  return row ? toDetail(row) : null
}

export async function updateVideoRepaintRequirement(params: {
  userId: string
  taskId: string
  title?: string
  requirement?: string
  checkpoints?: Record<'A' | 'B', boolean>
}) {
  const existing = await client.screenwriterTask.findFirst({
    where: { id: params.taskId, userId: params.userId },
    include: DETAIL_INCLUDE,
  })
  if (!existing) return null
  const currentStage = readString(toObject(existing).currentStage)
  const currentIndex = STAGE_ORDER.indexOf(currentStage as VideoRepaintRouteStage)
  const staleStages = currentIndex >= 0 ? STAGE_ORDER.slice(currentIndex + 1).filter((stage) => stage !== 'target_script') : []

  const updated = await client.$transaction(async (tx) => {
    if (staleStages.length > 0) {
      await tx.screenwriterStageState.updateMany({
        where: { screenwriterTaskId: params.taskId, stageKey: { in: staleStages } },
        data: { status: VIDEO_REPAINT_STAGE_STATUS.STALE },
      })
    }
    return await tx.screenwriterTask.update({
      where: { id: params.taskId },
      data: {
        ...(params.title?.trim() ? { title: params.title.trim() } : {}),
        ...(params.requirement?.trim() ? { requirement: params.requirement.trim() } : {}),
        ...(params.checkpoints ? { checkpointConfig: params.checkpoints as unknown as JsonValue } : {}),
      },
      include: DETAIL_INCLUDE,
    })
  })
  return toDetail(updated)
}

export async function runStage(params: {
  userId: string
  taskId: string
  stage: string
}) {
  const stage = normalizeStage(params.stage)
  const task = await client.screenwriterTask.findFirst({
    where: { id: params.taskId, userId: params.userId },
    include: DETAIL_INCLUDE,
  })
  if (!task) return null
  const stageState = (toObject(task).stageStates as unknown[] | undefined)?.find((item) => toObject(item).stageKey === stage)
  if (!stageState) throw new Error('SCREENWRITER_STAGE_NOT_FOUND')
  const status = normalizeStageStatus(readString(toObject(stageState).status))
  const runnableStatuses = new Set<VideoRepaintStageStatus>([
    VIDEO_REPAINT_STAGE_STATUS.NOT_STARTED,
    VIDEO_REPAINT_STAGE_STATUS.FAILED,
    VIDEO_REPAINT_STAGE_STATUS.STALE,
    VIDEO_REPAINT_STAGE_STATUS.QUEUED,
  ])
  if (!runnableStatuses.has(status)) {
    throw new Error('SCREENWRITER_STAGE_NOT_RUNNABLE')
  }

  await client.screenwriterStageState.update({
    where: { screenwriterTaskId_stageKey: { screenwriterTaskId: params.taskId, stageKey: stage } },
    data: {
      status: VIDEO_REPAINT_STAGE_STATUS.QUEUED,
      progress: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    },
  })
  const updated = await client.screenwriterTask.update({
    where: { id: params.taskId },
    data: {
      currentStage: stage,
      currentStageStatus: VIDEO_REPAINT_STAGE_STATUS.QUEUED,
    },
    include: DETAIL_INCLUDE,
  })
  return toDetail(updated)
}

export async function retryStage(params: {
  userId: string
  taskId: string
  stage: string
  episodeNumber?: number | null
}) {
  const stage = normalizeStage(params.stage)
  const task = await client.screenwriterTask.findFirst({
    where: { id: params.taskId, userId: params.userId },
    include: DETAIL_INCLUDE,
  })
  if (!task) return null
  const stageState = (toObject(task).stageStates as unknown[] | undefined)?.find((item) => toObject(item).stageKey === stage)
  const status = normalizeStageStatus(readString(toObject(stageState).status))
  const retryableStatuses = new Set<VideoRepaintStageStatus>([
    VIDEO_REPAINT_STAGE_STATUS.FAILED,
    VIDEO_REPAINT_STAGE_STATUS.STALE,
  ])
  if (!retryableStatuses.has(status)) {
    throw new Error('SCREENWRITER_STAGE_RETRY_ONLY_FAILED_OR_STALE')
  }
  return await runStage({ userId: params.userId, taskId: params.taskId, stage })
}

export async function approveStage(params: {
  userId: string
  taskId: string
  stage: string
  feedback?: string | null
}) {
  const stage = normalizeStage(params.stage)
  if (stage !== VIDEO_REPAINT_STAGE.SOURCE_SETTINGS && stage !== VIDEO_REPAINT_STAGE.TARGET_SETTINGS) {
    throw new Error('SCREENWRITER_STAGE_APPROVE_UNSUPPORTED')
  }
  const task = await client.screenwriterTask.findFirst({
    where: { id: params.taskId, userId: params.userId },
    include: DETAIL_INCLUDE,
  })
  if (!task) return null
  const review = (toObject(task).settingsReviews as unknown[] | undefined)
    ?.filter((item) => toObject(item).stageKey === stage)
    .at(-1)
  const next = nextStageForTask(readString(toObject(task).taskKind), stage)
  if (!next || next === 'target_script') throw new Error('SCREENWRITER_STAGE_NEXT_MISSING')

  const updated = await client.$transaction(async (tx) => {
    if (review) {
      await tx.screenwriterSettingsReview.update({
        where: { id: String(toObject(review).id) },
        data: {
          status: 'approved',
          latestFeedback: params.feedback || null,
          approvedAt: new Date(),
        },
      })
    }
    await tx.screenwriterReviewFeedback.create({
      data: {
        settingsReviewId: review ? String(toObject(review).id) : null,
        screenwriterTaskId: params.taskId,
        stageKey: stage,
        content: params.feedback || null,
        action: 'approve',
        createdBy: params.userId,
      },
    })
    await tx.screenwriterStageState.update({
      where: { screenwriterTaskId_stageKey: { screenwriterTaskId: params.taskId, stageKey: stage } },
      data: {
        status: VIDEO_REPAINT_STAGE_STATUS.APPROVED,
        approvedAt: new Date(),
        approvedBy: params.userId,
      },
    })
    await tx.screenwriterStageState.update({
      where: { screenwriterTaskId_stageKey: { screenwriterTaskId: params.taskId, stageKey: next } },
      data: { status: VIDEO_REPAINT_STAGE_STATUS.RUNNING, progress: 5 },
    })
    return await tx.screenwriterTask.update({
      where: { id: params.taskId },
      data: {
        currentStage: next,
        currentStageStatus: VIDEO_REPAINT_STAGE_STATUS.RUNNING,
      },
      include: DETAIL_INCLUDE,
    })
  })
  return toDetail(updated)
}

export async function regenerateSettings(params: {
  userId: string
  taskId: string
  stage: 'source_settings' | 'target_settings'
  feedback?: string | null
}) {
  const task = await client.screenwriterTask.findFirst({
    where: { id: params.taskId, userId: params.userId },
    include: DETAIL_INCLUDE,
  })
  if (!task) return null
  const reviews = ((toObject(task).settingsReviews as unknown[] | undefined) || [])
    .filter((item) => toObject(item).stageKey === params.stage)
  const latest = reviews.at(-1)
  const latestObject = toObject(latest)
  const version = Number(latestObject.version || reviews.length || 0) + 1
  const checkpoint = params.stage === 'source_settings' ? 'A' : 'B'

  const updated = await client.$transaction(async (tx) => {
    await tx.screenwriterSettingsReview.updateMany({
      where: { screenwriterTaskId: params.taskId, stageKey: params.stage },
      data: { status: 'stale' },
    })
    const review = await tx.screenwriterSettingsReview.create({
      data: {
        screenwriterTaskId: params.taskId,
        stageKey: params.stage,
        checkpoint,
        version,
        status: 'waiting_check',
        outlineTitle: readString(latestObject.outlineTitle) || (checkpoint === 'A' ? '源设定总纲' : '目标设定总纲'),
        bodySections: (latestObject.bodySections || []) as JsonValue,
        collapsedPanelTitle: readString(latestObject.collapsedPanelTitle) || (checkpoint === 'A' ? '统一名索引' : '映射关系'),
        nameIndexGroups: (latestObject.nameIndexGroups || []) as JsonValue,
        mappingGroups: (latestObject.mappingGroups || []) as JsonValue,
        issues: (latestObject.issues || []) as JsonValue,
        feedbackPlaceholder: readString(latestObject.feedbackPlaceholder) || '补充调整要求',
        latestFeedback: params.feedback || null,
      },
    })
    await tx.screenwriterReviewFeedback.create({
      data: {
        settingsReviewId: String(toObject(review).id),
        screenwriterTaskId: params.taskId,
        stageKey: params.stage,
        content: params.feedback || null,
        action: 'regenerate',
        createdBy: params.userId,
      },
    })
    await tx.screenwriterStageState.update({
      where: { screenwriterTaskId_stageKey: { screenwriterTaskId: params.taskId, stageKey: params.stage } },
      data: { status: VIDEO_REPAINT_STAGE_STATUS.WAITING_CHECK, progress: 100 },
    })
    return await tx.screenwriterTask.update({
      where: { id: params.taskId },
      data: {
        currentStage: params.stage,
        currentStageStatus: VIDEO_REPAINT_STAGE_STATUS.WAITING_CHECK,
      },
      include: DETAIL_INCLUDE,
    })
  })
  return toDetail(updated)
}

export async function listTargetScriptEpisodes(params: {
  userId: string
  taskId: string
  episodeNumber?: number | null
}): Promise<TargetScriptEpisodeDto[] | null> {
  const task = await client.screenwriterTask.findFirst({
    where: { id: params.taskId, userId: params.userId },
  })
  if (!task) return null
  const rows = await client.screenwriterScriptEpisode.findMany({
    where: {
      screenwriterTaskId: params.taskId,
      scriptKind: 'target',
      ...(params.episodeNumber ? { episodeNumber: params.episodeNumber } : {}),
    },
    orderBy: [{ episodeNumber: 'asc' }, { version: 'desc' }],
  })
  return rows.map((row) => toTargetScriptEpisode(row as Parameters<typeof toTargetScriptEpisode>[0]))
}

export async function getSourceScript(params: {
  userId: string
  taskId: string
}) {
  const task = await client.screenwriterTask.findFirst({
    where: { id: params.taskId, userId: params.userId },
  })
  if (!task) return null
  const artifact = await client.screenwriterArtifact.findFirst({
    where: {
      screenwriterTaskId: params.taskId,
      stageKey: VIDEO_REPAINT_STAGE.AUTO_SPLIT,
      artifactType: 'source_script_raw',
      refId: 'source-script',
    },
    orderBy: { version: 'desc' },
  })
  const payload = toObject(toObject(artifact).payload)
  return {
    sourceInputMode: readString(payload.sourceInputMode) || 'paste',
    sourceScriptName: readString(payload.sourceScriptName) || null,
    sourceScriptText: readString(payload.sourceScriptText),
  }
}

export async function updateSourceScript(params: {
  userId: string
  taskId: string
  sourceInputMode?: string | null
  sourceScriptName?: string | null
  sourceScriptText: string
}) {
  const task = await client.screenwriterTask.findFirst({
    where: { id: params.taskId, userId: params.userId },
  })
  if (!task) return null
  const sourceScriptText = params.sourceScriptText.trim()
  if (!sourceScriptText) throw new Error('INVALID_SOURCE_SCRIPT')
  const existing = await client.screenwriterArtifact.findFirst({
    where: {
      screenwriterTaskId: params.taskId,
      stageKey: VIDEO_REPAINT_STAGE.AUTO_SPLIT,
      artifactType: 'source_script_raw',
      refId: 'source-script',
    },
    orderBy: { version: 'desc' },
  })
  const payload = {
    sourceInputMode: params.sourceInputMode || 'paste',
    sourceScriptName: params.sourceScriptName || null,
    sourceScriptText,
  }
  if (!existing) {
    await client.screenwriterArtifact.create({
      data: {
        screenwriterTaskId: params.taskId,
        stageKey: VIDEO_REPAINT_STAGE.AUTO_SPLIT,
        artifactType: 'source_script_raw',
        refId: 'source-script',
        payload: payload as unknown as JsonValue,
        version: 1,
      },
    })
    return payload
  }
  await client.screenwriterArtifact.update({
    where: { id: String(toObject(existing).id) },
    data: { payload: payload as unknown as JsonValue },
  })
  return payload
}

export async function updateTargetScriptEpisode(params: {
  userId: string
  taskId: string
  episodeId: string
  title?: string | null
  content: string
}) {
  const task = await client.screenwriterTask.findFirst({
    where: { id: params.taskId, userId: params.userId },
  })
  if (!task) return null
  const existing = await client.screenwriterScriptEpisode.findFirst({
    where: {
      id: params.episodeId,
      screenwriterTaskId: params.taskId,
      scriptKind: 'target',
    },
  })
  if (!existing) return null
  const updated = await client.screenwriterScriptEpisode.update({
    where: { id: params.episodeId },
    data: {
      ...(params.title?.trim() ? { title: params.title.trim() } : {}),
      content: params.content,
      wordCount: countWords(params.content),
      updatedBy: params.userId,
    },
  })
  return toTargetScriptEpisode(updated as Parameters<typeof toTargetScriptEpisode>[0])
}
