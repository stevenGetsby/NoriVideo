/**
 * Revision-checked BatchItem updates only.
 * User writes require expectedRevision and fail once on conflict; system writes recompute
 * a patch from the latest row after each conflict. JSON fields are whole-field patches.
 */
import type { BatchItem, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import type {
  BatchItemInputPayload,
  BatchItemStageOutputs,
  BatchItemStatus,
  BatchStageState,
  WorkflowStage,
} from './types'

export type BatchItemRow = BatchItem

export interface BatchItemPatch {
  title?: string
  inputPayload?: BatchItemInputPayload | Prisma.InputJsonValue
  currentStage?: WorkflowStage | string
  status?: BatchItemStatus | string
  stageStates?: Partial<Record<WorkflowStage, BatchStageState>> | Prisma.InputJsonValue
  stageOutputs?: BatchItemStageOutputs | Prisma.InputJsonValue
  errorMessage?: string | null
  executionKey?: string | null
}

export type BatchItemSystemMutator = (
  row: BatchItemRow,
) => BatchItemPatch | null | undefined | Promise<BatchItemPatch | null | undefined>

export interface SystemBatchItemUpdateOptions {
  /** Maximum write attempts, including the first. Defaults to 5. */
  maxAttempts?: number
  workspaceOwnerId?: string
}

const JSON_FIELDS = ['inputPayload', 'stageStates', 'stageOutputs'] as const

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue
}

function staleRevision(itemId: string, expectedRevision: number): ApiError {
  return new ApiError('STALE_REVISION', {
    message: '工作流条目已被更新，请刷新后重试。',
    itemId,
    expectedRevision,
  })
}

function readRevision(row: BatchItemRow): number {
  return typeof row.revision === 'number' && Number.isFinite(row.revision)
    ? row.revision
    : 0
}

async function readRequiredBatchItemRow(
  itemId: string,
  workspaceOwnerId?: string,
): Promise<BatchItemRow> {
  const row = await readBatchItemRow(itemId, workspaceOwnerId)
  if (!row) {
    throw new ApiError('NOT_FOUND', { message: '工作流条目不存在或无权操作。' })
  }
  return row
}

async function writeRevisionCheckedPatch(
  itemId: string,
  expectedRevision: number,
  patch: BatchItemPatch,
  workspaceOwnerId?: string,
): Promise<BatchItemRow | null> {
  const data: Prisma.BatchItemUpdateManyMutationInput = {
    revision: { increment: 1 },
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || key === 'revision') continue
    if ((JSON_FIELDS as readonly string[]).includes(key)) {
      data[key as (typeof JSON_FIELDS)[number]] = toJsonInput(value)
    } else {
      Object.assign(data, { [key]: value })
    }
  }

  const result = await prisma.batchItem.updateMany({
    where: {
      id: itemId,
      revision: expectedRevision,
      ...(workspaceOwnerId ? { batchRun: { userId: workspaceOwnerId } } : {}),
    },
    data,
  })
  if (result.count === 0) return null
  return await readRequiredBatchItemRow(itemId, workspaceOwnerId)
}

/** Returns the newest raw row, or null when absent / outside the workspace. */
export async function readBatchItemRow(
  itemId: string,
  workspaceOwnerId?: string,
): Promise<BatchItemRow | null> {
  if (workspaceOwnerId) {
    return await prisma.batchItem.findFirst({
      where: { id: itemId, batchRun: { userId: workspaceOwnerId } },
    })
  }
  return await prisma.batchItem.findUnique({ where: { id: itemId } })
}

/** Single-attempt user write; empty patches return the current row without writing. */
export async function updateBatchItemForUser(params: {
  itemId: string
  expectedRevision: number
  patch: BatchItemPatch
  workspaceOwnerId?: string
}): Promise<BatchItemRow> {
  const current = await readRequiredBatchItemRow(params.itemId, params.workspaceOwnerId)
  const revision = readRevision(current)
  if (revision !== params.expectedRevision) {
    throw staleRevision(params.itemId, params.expectedRevision)
  }
  if (Object.values(params.patch).every((value) => value === undefined)) return current

  const updated = await writeRevisionCheckedPatch(params.itemId, revision, params.patch, params.workspaceOwnerId)
  if (!updated) throw staleRevision(params.itemId, params.expectedRevision)
  return updated
}

/** Latest-row system mutation with bounded, jittered CAS retries. */
export async function updateBatchItemWithRetry(
  itemId: string,
  mutator: BatchItemSystemMutator,
  options: SystemBatchItemUpdateOptions = {},
): Promise<BatchItemRow> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 5))
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const current = await readRequiredBatchItemRow(itemId, options.workspaceOwnerId)
    const patch = await mutator(current)
    if (!patch || Object.values(patch).every((value) => value === undefined)) return current

    const revision = readRevision(current)
    const updated = await writeRevisionCheckedPatch(itemId, revision, patch, options.workspaceOwnerId)
    if (updated) return updated
    if (attempt < maxAttempts) {
      const delayMs = Math.min(100, 10 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 10)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw staleRevision(itemId, -1)
}
