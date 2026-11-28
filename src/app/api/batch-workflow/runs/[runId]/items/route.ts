import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getWorkspaceActor, isProjectHiddenFromActor } from '@/lib/collaboration/access'
import {
  addItemsToBatchRun,
  getBatchRunById,
  removeBatchItem,
} from '@/lib/batch-workflow/service'
import {
  normalizeBatchItemInputPayload,
  type BatchRunItemSeedInput,
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

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const actor = getWorkspaceActor(authResult.session)
  const { runId } = await context.params

  const trimmedRunId = runId?.trim()
  if (!trimmedRunId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少 runId 参数。' })
  }

  const existing = await getBatchRunById({
    workspaceOwnerId: actor.workspaceOwnerId,
    runId: trimmedRunId,
    includeItems: false,
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }
  if (await isProjectHiddenFromActor(actor, existing.projectId)) {
    throw new ApiError('FORBIDDEN', { message: '当前账号无权向该工作流添加条目。' })
  }

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    throw new ApiError('INVALID_PARAMS', { message: '请求体必须为有效的 JSON 对象。' })
  }

  let rawItems: unknown[]
  if (body.items !== undefined) {
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new ApiError('INVALID_PARAMS', { message: 'items 必须为非空数组。' })
    }
    rawItems = body.items
  } else if (body.item !== undefined) {
    rawItems = [body.item]
  } else {
    rawItems = [body]
  }

  if (rawItems.length > 50) {
    throw new ApiError('INVALID_PARAMS', { message: '单次最多添加 50 条工作流条目。' })
  }

  const items = rawItems.map((entry, idx) => normalizeSeedItem(entry, `items[${idx}]`))

  const result = await addItemsToBatchRun({
    workspaceOwnerId: actor.workspaceOwnerId,
    runId: trimmedRunId,
    items,
  })

  return NextResponse.json({
    run: result.run,
    addedItems: result.addedItems,
  }, { status: 201 })
})

export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const actor = getWorkspaceActor(authResult.session)
  const { runId } = await context.params

  const trimmedRunId = runId?.trim()
  if (!trimmedRunId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少 runId 参数。' })
  }

  const existing = await getBatchRunById({
    workspaceOwnerId: actor.workspaceOwnerId,
    runId: trimmedRunId,
    includeItems: false,
  })
  if (!existing) {
    throw new ApiError('NOT_FOUND', { message: '工作流批次不存在或无权操作。' })
  }
  if (await isProjectHiddenFromActor(actor, existing.projectId)) {
    throw new ApiError('FORBIDDEN', { message: '当前账号无权删除该工作流条目。' })
  }

  let itemId = request.nextUrl.searchParams.get('itemId')?.trim() || ''
  if (!itemId) {
    const rawText = await request.text().catch(() => '')
    if (rawText.trim()) {
      try {
        const parsed = JSON.parse(rawText)
        if (isPlainObject(parsed) && typeof parsed.itemId === 'string') {
          itemId = parsed.itemId.trim()
        }
      } catch {
        throw new ApiError('INVALID_PARAMS', { message: '请求体 JSON 格式无效。' })
      }
    }
  }
  if (!itemId) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少要删除的 itemId 参数。' })
  }

  const result = await removeBatchItem({
    workspaceOwnerId: actor.workspaceOwnerId,
    runId: trimmedRunId,
    itemId,
  })

  return NextResponse.json({
    ok: true,
    deletedItemId: result.id,
    run: result.run,
  })
})
