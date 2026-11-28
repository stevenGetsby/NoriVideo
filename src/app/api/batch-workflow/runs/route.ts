import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth } from '@/lib/api-auth'
import { setAccountActorContext } from '@/lib/account/request-context'
import { findHiddenProjectIds, getWorkspaceActor, projectReadWhere } from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'
import { createBatchRun, listBatchRuns, mapBatchRunRow } from '@/lib/batch-workflow/service'
import {
  BATCH_RUN_MODE_VALUES,
  BATCH_RUN_STATUS_VALUES,
  normalizeBatchItemInputPayload,
  type BatchRunItemSeedInput,
  type BatchRunMode,
  type BatchRunStatus,
  type CreateBatchRunInput,
  type WorkflowModelConfig,
  type WorkflowStageParamsMap,
} from '@/lib/batch-workflow/types'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSeedItem(entry: unknown, label: string): BatchRunItemSeedInput {
  if (!isPlainObject(entry)) {
    throw new ApiError('INVALID_PARAMS', { message: `${label} 必须为对象。` })
  }
  if (entry.input !== undefined && !isPlainObject(entry.input)) {
    throw new ApiError('INVALID_PARAMS', { message: `${label}.input 必须为对象。` })
  }
  const rawInput = isPlainObject(entry.input) ? entry.input : entry
  const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : undefined
  return {
    ...(title ? { title } : {}),
    input: normalizeBatchItemInputPayload(rawInput),
  }
}

function normalizeRunItems(body: Record<string, unknown>): BatchRunItemSeedInput[] {
  if (body.items !== undefined) {
    if (!Array.isArray(body.items)) {
      throw new ApiError('INVALID_PARAMS', { message: 'items 必须为数组。' })
    }
    if (body.items.length > 50) {
      throw new ApiError('INVALID_PARAMS', { message: '单次创建最多支持 50 条条目。' })
    }
    return body.items.map((entry, idx) => normalizeSeedItem(entry, `items[${idx}]`))
  }

  if (body.initialItem !== undefined && body.initialItem !== null) {
    const seed = normalizeSeedItem(body.initialItem, 'initialItem')
    const hasContent = Boolean(
      seed.input.sourceVideoMaterialId
      || seed.input.sourceVideoStorageKey
      || seed.input.sourceVideoUrl
      || seed.input.pastedScript
      || seed.input.productName,
    )
    return hasContent ? [seed] : []
  }

  const hasTopLevelSource = Boolean(
    (typeof body.sourceVideoMaterialId === 'string' && body.sourceVideoMaterialId.trim())
    || (typeof body.sourceVideoStorageKey === 'string' && body.sourceVideoStorageKey.trim())
    || (typeof body.sourceVideoUrl === 'string' && body.sourceVideoUrl.trim())
    || (typeof body.pastedScript === 'string' && body.pastedScript.trim()),
  )
  if (hasTopLevelSource) {
    return [normalizeSeedItem(body, 'item')]
  }

  return []
}

export const GET = apiHandler(async (request: NextRequest) => {
  const params = request.nextUrl.searchParams
  const projectId = params.get('projectId')?.trim() || undefined
  const workId = params.get('workId')?.trim() || undefined
  const track = params.get('track')?.trim() || undefined
  const rawStatus = params.get('status')?.trim() || undefined
  const rawLimit = params.get('limit')

  const authResult = projectId
    ? await requireProjectAuthLight(projectId)
    : await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const actor = getWorkspaceActor(session)

  let status: BatchRunStatus | undefined
  if (rawStatus) {
    if (!BATCH_RUN_STATUS_VALUES.includes(rawStatus as BatchRunStatus)) {
      throw new ApiError('INVALID_PARAMS', { message: 'status 筛选参数无效。' })
    }
    status = rawStatus as BatchRunStatus
  }

  let limit: number | undefined
  if (rawLimit !== null && rawLimit !== '') {
    const parsed = Number(rawLimit)
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new ApiError('INVALID_PARAMS', { message: 'limit 必须为正整数。' })
    }
    limit = Math.min(100, Math.floor(parsed))
  }

  let runs = workId && !projectId
    ? (await prisma.batchRun.findMany({
        where: {
          userId: actor.workspaceOwnerId,
          workId,
          ...(track ? { track } : {}),
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit ?? 30,
        include: {
          items: {
            orderBy: { index: 'asc' },
            select: {
              id: true,
              batchRunId: true,
              revision: true,
              executionKey: true,
              index: true,
              title: true,
              inputPayload: true,
              currentStage: true,
              status: true,
              stageStates: true,
              stageOutputs: false,
              errorMessage: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      })).map((row) => mapBatchRunRow(row, { summaryItems: true }))
    : await listBatchRuns({
        workspaceOwnerId: actor.workspaceOwnerId,
        ...(projectId ? { projectId } : {}),
        ...(track ? { track } : {}),
        ...(status ? { status } : {}),
        ...(limit ? { limit } : {}),
      })

  if (projectId && workId) {
    runs = runs.filter((run) => run.workId === workId)
  }

  if (!projectId && runs.length > 0) {
    const hiddenProjectIds = await findHiddenProjectIds(session, runs.map((run) => run.projectId))
    if (hiddenProjectIds.size > 0) {
      runs = runs.filter((run) => !hiddenProjectIds.has(run.projectId))
    }
  }

  return NextResponse.json({ runs })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const actor = getWorkspaceActor(session)
  setAccountActorContext(actor.actorId, actor.workspaceOwnerId)

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
  if (!projectId) {
    throw new ApiError('INVALID_PARAMS', { message: '请选择目标作品（projectId）。' })
  }

  const project = await prisma.project.findFirst({
    where: projectReadWhere(session, projectId),
    select: { id: true, workId: true },
  })
  if (!project) {
    throw new ApiError('NOT_FOUND', { message: '目标作品不存在或当前账号无权访问。' })
  }

  if (body.runMode !== undefined && !BATCH_RUN_MODE_VALUES.includes(body.runMode as BatchRunMode)) {
    throw new ApiError('INVALID_PARAMS', { message: 'runMode 必须为 gated 或 auto。' })
  }
  if (body.templateId !== undefined && body.templateId !== null && typeof body.templateId !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'templateId 必须为字符串或 null。' })
  }
  if (body.track !== undefined && body.track !== null && typeof body.track !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: 'track 必须为字符串或 null。' })
  }
  const rawTitle = body.title ?? body.name
  if (rawTitle !== undefined && rawTitle !== null && typeof rawTitle !== 'string') {
    throw new ApiError('INVALID_PARAMS', { message: '批次标题必须为字符串。' })
  }
  if (body.modelConfig !== undefined && body.modelConfig !== null && !isPlainObject(body.modelConfig)) {
    throw new ApiError('INVALID_PARAMS', { message: 'modelConfig 必须为对象或 null。' })
  }
  if (body.stageSkillOverrides !== undefined && body.stageSkillOverrides !== null && !isPlainObject(body.stageSkillOverrides)) {
    throw new ApiError('INVALID_PARAMS', { message: 'stageSkillOverrides 必须为对象或 null。' })
  }
  if (body.stageParams !== undefined && body.stageParams !== null && !isPlainObject(body.stageParams)) {
    throw new ApiError('INVALID_PARAMS', { message: 'stageParams 必须为对象或 null。' })
  }

  const items = normalizeRunItems(body)

  const input: CreateBatchRunInput = {
    projectId: project.id,
    workId: typeof body.workId === 'string' && body.workId.trim() ? body.workId.trim() : project.workId,
    ...(typeof body.templateId === 'string' && body.templateId.trim() ? { templateId: body.templateId.trim() } : {}),
    ...(typeof body.track === 'string' && body.track.trim() ? { track: body.track.trim() } : {}),
    ...(typeof rawTitle === 'string' && rawTitle.trim() ? { title: rawTitle.trim() } : {}),
    ...(body.runMode !== undefined ? { runMode: body.runMode as BatchRunMode } : {}),
    ...(body.modelConfig !== undefined
      ? { modelConfig: body.modelConfig as Partial<WorkflowModelConfig> | null }
      : {}),
    ...(body.stageSkillOverrides !== undefined
      ? { stageSkillOverrides: body.stageSkillOverrides as Record<string, string> | null }
      : {}),
    ...(body.stageParams !== undefined
      ? { stageParams: body.stageParams as WorkflowStageParamsMap | null }
      : {}),
    items,
  }

  const run = await createBatchRun({
    workspaceOwnerId: actor.workspaceOwnerId,
    actorId: actor.actorId,
    input,
  })

  return NextResponse.json({ run }, { status: 201 })
})
