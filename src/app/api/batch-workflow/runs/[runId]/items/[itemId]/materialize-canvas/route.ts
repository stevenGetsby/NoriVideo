import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { setAccountActorContext } from '@/lib/account/request-context'
import { getWorkspaceActor, projectReadWhere } from '@/lib/collaboration/access'
import { prisma } from '@/lib/prisma'
import { getBatchRunById } from '@/lib/batch-workflow/service'
import { materializeBatchItemToCanvas } from '@/lib/batch-workflow/materialize-canvas'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ runId: string; itemId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const actor = getWorkspaceActor(session)
  setAccountActorContext(actor.actorId, actor.workspaceOwnerId)
  const { runId, itemId } = await context.params

  const trimmedRunId = runId?.trim()
  const trimmedItemId = itemId?.trim()
  if (!trimmedRunId || !trimmedItemId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少 runId 或 itemId 参数。' })
  }

  const existing = await getBatchRunById({
    workspaceOwnerId: actor.workspaceOwnerId,
    runId: trimmedRunId,
    includeItems: false,
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }

  const project = await prisma.project.findFirst({
    where: projectReadWhere(session, existing.projectId),
    select: { id: true },
  })
  if (!project) {
    throw new ApiError('NOT_FOUND', { message: '所属作品不存在或当前账号无权访问，无法展开到无限画布。' })
  }

  const rawText = await request.text().catch(() => '')
  let forceNew = false
  let mode: 'create' | 'sync' | 'check' | undefined
  let expectedRevision: number | undefined
  if (rawText.trim()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch {
      throw new ApiError('INVALID_PARAMS', { message: '请求体 JSON 格式无效。' })
    }
    if (!isPlainObject(parsed)) {
      throw new ApiError('INVALID_PARAMS', { message: '请求体必须为 JSON 对象。' })
    }
    if (parsed.forceNew !== undefined && typeof parsed.forceNew !== 'boolean') {
      throw new ApiError('INVALID_PARAMS', { message: 'forceNew 必须为布尔值。' })
    }
    forceNew = parsed.forceNew === true
    if (parsed.mode !== undefined && !['create', 'sync', 'check'].includes(String(parsed.mode))) {
      throw new ApiError('INVALID_PARAMS', { message: 'mode 必须为 create、sync 或 check。' })
    }
    mode = parsed.mode as typeof mode
    if (parsed.expectedRevision !== undefined && (
      !Number.isInteger(parsed.expectedRevision) || Number(parsed.expectedRevision) < 0
    )) {
      throw new ApiError('INVALID_PARAMS', { message: 'expectedRevision 必须为非负整数。' })
    }
    expectedRevision = parsed.expectedRevision as number | undefined
  }

  const result = await materializeBatchItemToCanvas({
    workspaceOwnerId: actor.workspaceOwnerId,
    actorId: actor.actorId,
    batchRunId: trimmedRunId,
    itemId: trimmedItemId,
    forceNew,
    mode,
    expectedRevision,
  })

  return NextResponse.json({
    canvasId: result.canvasId,
    projectId: result.projectId,
    canvasUrl: result.href,
    href: result.href,
    reused: result.reused,
    nodeCount: result.nodeCount,
    edgeCount: result.edgeCount,
    ...(result.item ? { item: result.item } : {}),
    ...(result.stale !== undefined ? { stale: result.stale } : {}),
    fingerprint: result.fingerprint,
    ...(result.canvasFingerprint !== undefined ? { canvasFingerprint: result.canvasFingerprint } : {}),
    ...(result.synced !== undefined ? { synced: result.synced } : {}),
    ...(result.updatedNodeCount !== undefined ? { updatedNodeCount: result.updatedNodeCount } : {}),
    skippedShots: result.skippedShots,
  })
})
