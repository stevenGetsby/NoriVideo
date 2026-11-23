/**
 * 手填外部花费条目：录入 / 作废 / 编辑（作废+新建）。
 * 金额一律服务端按 quantity × 当前汇率快照计算，请求体里的 rate/amount 忽略（R5）。
 * 成员只能记/改/作废自己最近 14 天的条目；导入行成员不可改。软作废，不物理删除（R7）。
 */
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { logInfo } from '@/lib/logging/core'
import { toMoneyNumber, type MoneyValue } from '@/lib/billing/money'
import { requireActiveWorkspaceUser } from '@/lib/collaboration/access'
import {
  ENTRY_KINDS,
  type EntryKind,
  computeEntryAmountMicros,
  daysBetweenKeys,
  fromMicros,
  isValidDateKey,
  todayKey,
} from './calc'
import { getOrCreateSetting } from './sync'
import type { LedgerCtx } from './route-helpers'

export const MEMBER_BACKDATE_DAYS = 14
export const ENTRY_SANITY_MAX_CNY = 100_000
const MIN_DATE_KEY = '2020-01-01'

export type CreateEntryInput = {
  ledgerProjectId: string
  dateKey: string
  kind: EntryKind
  quantity: number
  remark?: string | null
  actorUserId?: string | null
  confirmLarge?: boolean
}

export type EntryView = {
  id: string
  ledgerProjectId: string
  projectName: string
  dateKey: string
  actorUserId: string | null
  actorLabel: string
  kind: EntryKind
  quantity: number
  rate: number
  amountCny: number
  remark: string | null
  source: string
  importBatchId: string | null
  replacesEntryId: string | null
  createdById: string
  createdAt: string
  voidedAt: string | null
  editable: boolean
}

function validateQuantity(kind: EntryKind, quantity: unknown, isAdmin: boolean): number {
  const num = Number(quantity)
  if (!Number.isFinite(num)) {
    throw new ApiError('INVALID_PARAMS', { message: '数量必须是数字。' })
  }
  if (kind === 'api_token') {
    if (!Number.isInteger(num) || num < 1 || num > 1e12) {
      throw new ApiError('INVALID_PARAMS', { message: 'API token 数量必须是 1 到 1e12 的整数。' })
    }
    return num
  }
  if (kind === 'jimeng_points') {
    if (num < 0.01 || num > 1e9 || Math.round(num * 100) / 100 !== num) {
      throw new ApiError('INVALID_PARAMS', { message: '即梦积分必须在 0.01 到 1e9 之间，最多 2 位小数。' })
    }
    return num
  }
  if (isAdmin) {
    if (num === 0) throw new ApiError('INVALID_PARAMS', { message: '金额不能为 0。' })
    return num
  }
  if (num < 0.01 || num > 1e7) {
    throw new ApiError('INVALID_PARAMS', { message: '金额必须在 0.01 到 1e7 元之间。' })
  }
  return num
}

async function resolveProject(ctx: LedgerCtx, ledgerProjectId: string) {
  const project = await prisma.ledgerProject.findFirst({
    where: { id: ledgerProjectId, workspaceOwnerId: ctx.ownerId },
  })
  if (!project) throw new ApiError('NOT_FOUND', { message: '账本项目不存在。' })
  if (project.archivedAt != null) throw new ApiError('INVALID_PARAMS', { message: '该项目已归档，不能记账。' })
  if (!ctx.isAdmin && project.workId != null) {
    const work = await prisma.work.findFirst({
      where: {
        id: project.workId,
        workspaceOwnerId: ctx.ownerId,
        deletedAt: null,
        OR: [{ createdById: ctx.actorId }, { members: { some: { userId: ctx.actorId } } }],
      },
      select: { id: true },
    })
    if (!work) throw new ApiError('NOT_FOUND', { message: '账本项目不存在。' })
  }
  return project
}

function validateDateKey(ctx: LedgerCtx, dateKey: unknown): string {
  if (typeof dateKey !== 'string' || !isValidDateKey(dateKey)) {
    throw new ApiError('INVALID_PARAMS', { message: '日期必须是 YYYY-MM-DD 格式的真实日期。' })
  }
  const today = todayKey()
  if (dateKey > today) throw new ApiError('INVALID_PARAMS', { message: '不能记录晚于今天的日期。' })
  if (ctx.isAdmin) {
    if (dateKey < MIN_DATE_KEY) throw new ApiError('INVALID_PARAMS', { message: `日期不能早于 ${MIN_DATE_KEY}。` })
  } else if (daysBetweenKeys(dateKey, today) > MEMBER_BACKDATE_DAYS) {
    throw new ApiError('INVALID_PARAMS', { message: `成员只能记录最近 ${MEMBER_BACKDATE_DAYS} 天内的花费。` })
  }
  return dateKey
}

async function resolveActor(ctx: LedgerCtx, requestedActorUserId?: string | null): Promise<{ actorUserId: string; actorLabel: string }> {
  if (ctx.isAdmin && requestedActorUserId) {
    const user = await requireActiveWorkspaceUser(ctx.ownerId, requestedActorUserId)
    return { actorUserId: user.id, actorLabel: (user.name ?? '未知账号').slice(0, 64) }
  }
  const self = await prisma.user.findUnique({ where: { id: ctx.actorId }, select: { id: true, name: true } })
  return { actorUserId: ctx.actorId, actorLabel: (self?.name ?? '未知账号').slice(0, 64) }
}

type PreparedEntry = {
  workspaceOwnerId: string
  ledgerProjectId: string
  dateKey: string
  actorUserId: string
  actorLabel: string
  kind: EntryKind
  quantity: number
  rate: number
  amountCny: number
  remark: string | null
  createdById: string
  amountMicros: number
}

async function prepareEntry(ctx: LedgerCtx, input: CreateEntryInput): Promise<PreparedEntry> {
  if (!(ENTRY_KINDS as readonly string[]).includes(input.kind)) {
    throw new ApiError('INVALID_PARAMS', { message: '条目类型取值非法。' })
  }
  const project = await resolveProject(ctx, input.ledgerProjectId)
  const dateKey = validateDateKey(ctx, input.dateKey)
  const quantity = validateQuantity(input.kind, input.quantity, ctx.isAdmin)
  const remark = input.remark ? String(input.remark).trim().slice(0, 500) : null
  if (input.kind === 'other_cny' && ctx.isAdmin && quantity < 0 && !remark) {
    throw new ApiError('INVALID_PARAMS', { message: '负数校准条目必须填写备注。' })
  }
  const setting = await getOrCreateSetting(ctx.ownerId)
  const rate = input.kind === 'api_token'
    ? toMoneyNumber(setting.tokenRateCnyPerMillion)
    : input.kind === 'jimeng_points'
      ? toMoneyNumber(setting.jimengCnyPerPoint)
      : 1
  const amountMicros = computeEntryAmountMicros(input.kind, quantity, rate)
  const amountCny = fromMicros(amountMicros)
  if (amountCny > ENTRY_SANITY_MAX_CNY && !(ctx.isAdmin && input.confirmLarge)) {
    throw new ApiError('INVALID_PARAMS', { message: `单条金额超过 ¥${ENTRY_SANITY_MAX_CNY}，请核对数量；管理员可确认后放行。` })
  }
  const actor = await resolveActor(ctx, input.actorUserId)
  return {
    workspaceOwnerId: ctx.ownerId,
    ledgerProjectId: project.id,
    dateKey,
    actorUserId: actor.actorUserId,
    actorLabel: actor.actorLabel,
    kind: input.kind,
    quantity,
    rate,
    amountCny,
    remark,
    createdById: ctx.actorId,
    amountMicros,
  }
}

function toView(entry: {
  id: string
  ledgerProjectId: string
  dateKey: string
  actorUserId: string | null
  actorLabel: string
  kind: string
  quantity: MoneyValue
  rate: MoneyValue
  amountCny: MoneyValue
  remark: string | null
  source: string
  importBatchId: string | null
  replacesEntryId: string | null
  createdById: string
  createdAt: Date
  voidedAt: Date | null
  ledgerProject?: { name: string }
}, ctx: LedgerCtx): EntryView {
  const today = todayKey()
  const editable = ctx.isAdmin
    ? entry.voidedAt == null
    : entry.voidedAt == null && entry.source !== 'import' && daysBetweenKeys(entry.dateKey, today) <= MEMBER_BACKDATE_DAYS
  return {
    id: entry.id,
    ledgerProjectId: entry.ledgerProjectId,
    projectName: entry.ledgerProject?.name ?? '',
    dateKey: entry.dateKey,
    actorUserId: entry.actorUserId,
    actorLabel: entry.actorLabel,
    kind: entry.kind as EntryKind,
    quantity: toMoneyNumber(entry.quantity),
    rate: toMoneyNumber(entry.rate),
    amountCny: toMoneyNumber(entry.amountCny),
    remark: entry.remark,
    source: entry.source,
    importBatchId: entry.importBatchId,
    replacesEntryId: entry.replacesEntryId,
    createdById: entry.createdById,
    createdAt: entry.createdAt.toISOString(),
    voidedAt: entry.voidedAt ? entry.voidedAt.toISOString() : null,
    editable,
  }
}

export async function createEntry(ctx: LedgerCtx, input: CreateEntryInput): Promise<EntryView> {
  const prepared = await prepareEntry(ctx, input)
  const { amountMicros, ...data } = prepared
  void amountMicros
  const entry = await prisma.ledgerEntry.create({ data: { ...data, source: 'manual' }, include: { ledgerProject: { select: { name: true } } } })
  logInfo('[LedgerAudit] entry.create', {
    operator: ctx.actorId,
    entryId: entry.id,
    ledgerProjectId: entry.ledgerProjectId,
    dateKey: entry.dateKey,
    kind: entry.kind,
    amountCny: prepared.amountCny,
    onBehalfOf: prepared.actorUserId !== ctx.actorId ? prepared.actorUserId : undefined,
  })
  return toView(entry, ctx)
}

async function findEditableEntry(ctx: LedgerCtx, id: string) {
  const entry = await prisma.ledgerEntry.findFirst({ where: { id, workspaceOwnerId: ctx.ownerId } })
  if (!entry) throw new ApiError('NOT_FOUND', { message: '条目不存在。' })
  if (!ctx.isAdmin) {
    if (entry.actorUserId !== ctx.actorId) throw new ApiError('FORBIDDEN', { message: '只能修改自己记录的条目。' })
    if (entry.source === 'import') throw new ApiError('FORBIDDEN', { message: '导入的条目不能由成员修改。' })
    if (daysBetweenKeys(entry.dateKey, todayKey()) > MEMBER_BACKDATE_DAYS) {
      throw new ApiError('FORBIDDEN', { message: `只能修改最近 ${MEMBER_BACKDATE_DAYS} 天内的条目。` })
    }
  }
  return entry
}

export async function voidEntry(ctx: LedgerCtx, id: string): Promise<{ id: string; voided: boolean }> {
  const entry = await findEditableEntry(ctx, id)
  if (entry.voidedAt != null) return { id, voided: true }
  await prisma.ledgerEntry.update({
    where: { id },
    data: { voidedAt: new Date(), voidedById: ctx.actorId },
  })
  logInfo('[LedgerAudit] entry.void', { operator: ctx.actorId, entryId: id })
  return { id, voided: true }
}

export async function replaceEntry(ctx: LedgerCtx, id: string, input: CreateEntryInput): Promise<EntryView> {
  const old = await findEditableEntry(ctx, id)
  const prepared = await prepareEntry(ctx, input)
  const { amountMicros, ...data } = prepared
  void amountMicros
  const entry = await prisma.$transaction(async (tx) => {
    if (old.voidedAt == null) {
      await tx.ledgerEntry.update({ where: { id }, data: { voidedAt: new Date(), voidedById: ctx.actorId } })
    }
    return tx.ledgerEntry.create({
      data: { ...data, source: 'manual', replacesEntryId: id },
      include: { ledgerProject: { select: { name: true } } },
    })
  })
  logInfo('[LedgerAudit] entry.replace', { operator: ctx.actorId, oldEntryId: id, entryId: entry.id, amountCny: prepared.amountCny })
  return toView(entry, ctx)
}

export type EntryListQuery = {
  from?: string | null
  to?: string | null
  projectId?: string | null
  actorKey?: string | null
  kind?: EntryKind | null
  source?: string | null
  importBatchId?: string | null
  includeVoided?: boolean
  page?: number
  pageSize?: number
}

export async function listEntries(ctx: LedgerCtx, query: EntryListQuery): Promise<{ rows: EntryView[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(500, Math.max(1, query.pageSize ?? 100))
  const where: Record<string, unknown> = { workspaceOwnerId: ctx.ownerId }
  if (query.from || query.to) {
    where.dateKey = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) }
  }
  if (query.projectId) where.ledgerProjectId = query.projectId
  if (query.kind) where.kind = query.kind
  if (query.source) where.source = query.source
  if (query.importBatchId) where.importBatchId = query.importBatchId
  if (!query.includeVoided) where.voidedAt = null
  if (query.actorKey) {
    if (query.actorKey.startsWith('u:')) where.actorUserId = query.actorKey.slice(2)
    else if (query.actorKey.startsWith('l:')) {
      where.actorUserId = null
      where.actorLabel = query.actorKey.slice(2)
    }
  }
  const [total, entries] = await Promise.all([
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.findMany({
      where,
      include: { ledgerProject: { select: { name: true } } },
      orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return { rows: entries.map((entry) => toView(entry, ctx)), total, page, pageSize }
}

/** 成员「我的算力」：我自己的未作废条目，带 editable。 */
export async function listMyEntries(ctx: LedgerCtx, from: string | null, to: string | null): Promise<EntryView[]> {
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      workspaceOwnerId: ctx.ownerId,
      actorUserId: ctx.actorId,
      voidedAt: null,
      ...(from || to ? { dateKey: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    include: { ledgerProject: { select: { name: true } } },
    orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
  })
  return entries.map((entry) => toView(entry, ctx))
}