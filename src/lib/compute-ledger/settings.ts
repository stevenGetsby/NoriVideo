/**
 * 工作区账本设置：汇率 + 同步水位。改汇率只影响之后新录入的条目，
 * 旧条目的 rate / amountCny 是保存时的快照，保持不变。
 */
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { logInfo } from '@/lib/logging/core'
import { toMoneyNumber } from '@/lib/billing/money'
import { getOrCreateSetting } from './sync'
import type { LedgerCtx } from './route-helpers'

export type LedgerSettingsView = {
  tokenRateCnyPerMillion: number
  jimengCnyPerPoint: number
  syncedThroughDate: string | null
  lastSyncAt: string | null
}

export async function getSettings(ownerId: string): Promise<LedgerSettingsView> {
  const setting = await getOrCreateSetting(ownerId)
  return {
    tokenRateCnyPerMillion: toMoneyNumber(setting.tokenRateCnyPerMillion),
    jimengCnyPerPoint: toMoneyNumber(setting.jimengCnyPerPoint),
    syncedThroughDate: setting.syncedThroughDate,
    lastSyncAt: setting.lastSyncAt ? setting.lastSyncAt.toISOString() : null,
  }
}

function validateRate(value: unknown, name: string): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0 || num > 10000) {
    throw new ApiError('INVALID_PARAMS', { message: `${name} 必须在 0 到 10000 之间。` })
  }
  if (Math.round(num * 1e6) / 1e6 !== num) {
    throw new ApiError('INVALID_PARAMS', { message: `${name} 最多 6 位小数。` })
  }
  return num
}

export async function updateSettings(
  ctx: LedgerCtx,
  input: { tokenRateCnyPerMillion?: number; jimengCnyPerPoint?: number },
): Promise<LedgerSettingsView> {
  const data: { tokenRateCnyPerMillion?: number; jimengCnyPerPoint?: number; updatedById: string } = {
    updatedById: ctx.actorId,
  }
  if (input.tokenRateCnyPerMillion !== undefined) {
    data.tokenRateCnyPerMillion = validateRate(input.tokenRateCnyPerMillion, 'API token 单价')
  }
  if (input.jimengCnyPerPoint !== undefined) {
    data.jimengCnyPerPoint = validateRate(input.jimengCnyPerPoint, '即梦积分单价')
  }
  await getOrCreateSetting(ctx.ownerId)
  await prisma.ledgerSetting.update({ where: { workspaceOwnerId: ctx.ownerId }, data })
  logInfo('[LedgerAudit] settings', { operator: ctx.actorId, ...data })
  return getSettings(ctx.ownerId)
}