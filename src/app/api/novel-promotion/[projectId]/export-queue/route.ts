import { NextRequest } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import {
  formatExportReadinessBlocker,
  normalizeExportReadinessCardId,
  resolveExportReadiness,
} from '@/lib/novel-promotion/export-readiness'
import {
  readExportQueue,
  updateExportQueueTask,
  upsertExportQueueRecord,
} from '@/lib/novel-promotion/export-queue-store'
import { resolveExportScope } from '@/lib/novel-promotion/export-scope'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const scope = await resolveExportScope({
    projectId,
    episodeId: request.nextUrl.searchParams.get('episodeId'),
  })
  if (!scope) {
    throw new ApiError('NOT_FOUND')
  }
  const { episodeId } = scope

  const records = await readExportQueue({
    userId: authResult.session.user.id,
    projectId,
    episodeId,
  })
  const readiness = episodeId
    ? await resolveExportReadiness({
        userId: authResult.session.user.id,
        projectId,
        episodeId,
      })
    : null

  return Response.json({
    projectId,
    episodeId: episodeId || null,
    stats: readiness?.stats ?? null,
    items: readiness?.items ?? [],
    records,
  })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const rawEpisodeId = request.nextUrl.searchParams.get('episodeId')
  if (!rawEpisodeId || !rawEpisodeId.trim()) {
    throw new ApiError('INVALID_PARAMS', { message: 'episodeId is required' })
  }
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const scope = await resolveExportScope({
    projectId,
    episodeId: rawEpisodeId,
  })
  if (!scope?.episodeId) {
    throw new ApiError('NOT_FOUND')
  }
  const episodeId = scope.episodeId

  const body = await request.json().catch(() => ({})) as {
    cardId?: string
  }
  const cardId = normalizeExportReadinessCardId(body.cardId)
  if (!cardId) {
    throw new ApiError('INVALID_PARAMS')
  }
  const readiness = await resolveExportReadiness({
    userId: authResult.session.user.id,
    projectId,
    episodeId,
  })
  if (!readiness) {
    throw new ApiError('NOT_FOUND')
  }
  const item = readiness.items.find((candidate) => candidate.cardId === cardId)
  if (!item) {
    throw new ApiError('INVALID_PARAMS')
  }
  const blocker = formatExportReadinessBlocker(item)
  const queueStatus = item.status === 'blocked' ? 'blocked' : 'queued'

  let records = await upsertExportQueueRecord({
    userId: authResult.session.user.id,
    projectId,
    episodeId,
    record: {
      cardId,
      title: item.title,
      status: queueStatus,
      blocker: item.status === 'blocked' ? blocker : null,
      stats: readiness.stats,
    },
  })
  let task: Awaited<ReturnType<typeof submitTask>> | null = null

  if (item.status === 'blocked') {
    return Response.json({
      success: false,
      blocked: true,
      blocker,
      stats: readiness.stats,
      items: readiness.items,
      records,
    }, { status: 409 })
  }

  if (queueStatus === 'queued') {
    const taskLocale = resolveTaskLocale(request, body) || 'zh'
    task = await submitTask({
      userId: authResult.session.user.id,
      locale: taskLocale,
      projectId,
      episodeId,
      type: TASK_TYPE.EXPORT_DELIVERY,
      targetType: 'export_queue',
      targetId: `${episodeId}:${cardId}`,
      payload: {
        cardId,
        title: item.title,
        blocker: null,
        meta: {
          locale: taskLocale,
        },
      },
      dedupeKey: `export-delivery:${authResult.session.user.id}:${projectId}:${episodeId}:${cardId}`,
      maxAttempts: 2,
      requestId: getRequestId(request),
      billingInfo: {
        billable: false,
        source: 'task',
        status: 'skipped',
      },
    })
    await updateExportQueueTask({
      userId: authResult.session.user.id,
      projectId,
      episodeId,
      cardId,
      taskId: task.taskId,
    })
    records = await readExportQueue({
      userId: authResult.session.user.id,
      projectId,
      episodeId,
    })
  }

  return Response.json({
    success: true,
    task,
    stats: readiness.stats,
    items: readiness.items,
    records,
  })
})
