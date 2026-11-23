/**
 * 历史导入的落库层：加载只读快照 → buildImportPlan（与 dry-run 同一计划）→ 校验 hash/重叠 → 写项目与条目。
 * 条目按 importKey 幂等（createMany skipDuplicates），失败已写批次保留，重跑续上。
 * 回滚软作废该批次并把 importKey 置空（@unique 允许多 NULL），新建项目不删除。
 * 真实数据 commit 必须等用户选 A/B/C（§16 Q1）；本模块不自行决定。
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { logInfo } from '@/lib/logging/core'
import { toMoneyNumber } from '@/lib/billing/money'
import { workspaceUserWhere } from '@/lib/collaboration/access'
import { ACTIVITY_OFFSET_MS } from '@/lib/account/activity-stats-shared'
import { toMicros } from './calc'
import {
  buildImportPlan,
  type ImportData,
  type ImportOptions,
  type ImportPayload,
  type ImportReport,
  type PlannedProject,
} from './import-plan'
import { syncPlatformFacts } from './sync'
import type { LedgerCtx } from './route-helpers'

const ENTRY_BATCH = 200

export type RunImportInput = {
  mode: 'dry-run' | 'commit'
  carryForward: 'none' | 'stated-total'
  acknowledgeOverlap?: boolean
  expectedHash?: string
  payload: ImportPayload
}

async function loadImportData(ownerId: string): Promise<ImportData> {
  const [projects, works, accounts, keyRows, factGroups] = await Promise.all([
    prisma.ledgerProject.findMany({ where: { workspaceOwnerId: ownerId } }),
    prisma.work.findMany({ where: { workspaceOwnerId: ownerId, deletedAt: null }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: workspaceUserWhere(ownerId), select: { id: true, name: true } }),
    prisma.ledgerEntry.findMany({ where: { workspaceOwnerId: ownerId, importKey: { not: null } }, select: { importKey: true } }),
    prisma.ledgerDailyFact.groupBy({
      by: ['ledgerProjectId', 'dateKey'],
      where: { workspaceOwnerId: ownerId },
      _sum: { costCny: true },
    }),
  ])
  const workIdByProject = new Map(projects.map((project) => [project.id, project.workId]))
  const platformFacts: ImportData['platformFacts'] = []
  for (const row of factGroups) {
    const workId = workIdByProject.get(row.ledgerProjectId)
    if (!workId) continue
    platformFacts.push({ workId, dateKey: row.dateKey, costMicros: toMicros(toMoneyNumber(row._sum.costCny)) })
  }
  return {
    existingProjects: projects.map((project) => ({
      id: project.id,
      nameKey: project.nameKey,
      workId: project.workId,
      archivedAt: project.archivedAt,
      category: project.category,
      budgetCny: project.budgetCny == null ? null : toMoneyNumber(project.budgetCny),
      startDate: project.startDate,
      targetDeliveryDate: project.targetDeliveryDate,
      totalEpisodes: project.totalEpisodes,
      doneEpisodes: project.doneEpisodes,
    })),
    works,
    linkedWorkIds: projects.map((project) => project.workId).filter((id): id is string => !!id),
    accounts: accounts.map((account) => ({ id: account.id, name: account.name ?? '' })),
    existingImportKeys: keyRows.map((row) => row.importKey).filter((key): key is string => !!key),
    platformFacts,
  }
}

function makeBatchId(): string {
  const shifted = new Date(Date.now() + ACTIVITY_OFFSET_MS)
  const stamp = shifted.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0')
  return `imp-${stamp}-${rand}`
}

/** 只补当前为空的字段，绝不覆盖管理员已改过的值。 */
async function fillProjectMeta(id: string, meta: PlannedProject['meta']): Promise<void> {
  const existing = await prisma.ledgerProject.findUnique({ where: { id } })
  if (!existing) return
  const data: Record<string, unknown> = {}
  if (existing.category == null && meta.category != null) data.category = meta.category
  if (existing.budgetCny == null && meta.budgetCny != null) data.budgetCny = meta.budgetCny
  if (existing.startDate == null && meta.startDate != null) data.startDate = meta.startDate
  if (existing.targetDeliveryDate == null && meta.targetDeliveryDate != null) data.targetDeliveryDate = meta.targetDeliveryDate
  if (existing.totalEpisodes == null && meta.totalEpisodes != null) data.totalEpisodes = meta.totalEpisodes
  if (existing.doneEpisodes == null && meta.doneEpisodes != null) data.doneEpisodes = meta.doneEpisodes
  if (Object.keys(data).length > 0) await prisma.ledgerProject.update({ where: { id }, data })
}

export async function runImport(ctx: LedgerCtx, input: RunImportInput): Promise<ImportReport> {
  await syncPlatformFacts(ctx.ownerId, { refresh: true, maxChunks: 6 })
  const data = await loadImportData(ctx.ownerId)
  const options: ImportOptions = { carryForward: input.carryForward, acknowledgeOverlap: input.acknowledgeOverlap }
  const plan = buildImportPlan(ctx.ownerId, input.payload, options, data)
  const report = plan.report
  if (input.mode === 'dry-run') return report

  if (report.errors.length > 0) {
    throw new ApiError('INVALID_PARAMS', { message: '导入数据存在错误，请先修正后再提交。', errors: report.errors })
  }
  if (!input.expectedHash || input.expectedHash !== report.reportHash) {
    throw new ApiError('CONFLICT', { message: '数据或选项与上次 dry-run 不一致，请重新 dry-run 后再提交。' })
  }
  if (report.overlaps.length > 0 && !input.acknowledgeOverlap) {
    throw new ApiError('CONFLICT', {
      message: '导入数据与平台自动记账的时间范围重叠，请确认表格里的 token 不是在平台内调用产生的。',
      overlaps: report.overlaps,
    })
  }

  const batchId = makeBatchId()
  const projectIdByKey = new Map<string, string>()
  for (const planned of plan.projects) {
    if (planned.action === 'reuse' && planned.existingId) {
      projectIdByKey.set(planned.nameKey, planned.existingId)
      await fillProjectMeta(planned.existingId, planned.meta)
      continue
    }
    let projectId: string
    try {
      const created = await prisma.ledgerProject.create({
        data: {
          workspaceOwnerId: ctx.ownerId,
          workId: planned.workId ?? null,
          name: planned.name,
          nameKey: planned.nameKey,
          category: planned.meta.category,
          status: 'in_progress',
          startDate: planned.meta.startDate,
          targetDeliveryDate: planned.meta.targetDeliveryDate,
          budgetCny: planned.meta.budgetCny,
          totalEpisodes: planned.meta.totalEpisodes,
          doneEpisodes: planned.meta.doneEpisodes,
        },
        select: { id: true },
      })
      projectId = created.id
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.ledgerProject.findFirst({
          where: { workspaceOwnerId: ctx.ownerId, nameKey: planned.nameKey, archivedAt: null },
          select: { id: true },
        })
        if (!existing) throw error
        projectId = existing.id
        await fillProjectMeta(projectId, planned.meta)
      } else {
        throw error
      }
    }
    projectIdByKey.set(planned.nameKey, projectId)
  }

  let written = 0
  for (let offset = 0; offset < plan.entries.length; offset += ENTRY_BATCH) {
    const batch = plan.entries.slice(offset, offset + ENTRY_BATCH)
    const rows = batch.map((entry) => {
      const ledgerProjectId = projectIdByKey.get(entry.projectNameKey)
      if (!ledgerProjectId) throw new ApiError('INVALID_PARAMS', { message: `导入项目缺失：${entry.projectNameKey}` })
      return {
        workspaceOwnerId: ctx.ownerId,
        ledgerProjectId,
        dateKey: entry.dateKey,
        actorUserId: entry.actorUserId,
        actorLabel: entry.actorLabel,
        kind: entry.kind,
        quantity: entry.quantity,
        rate: entry.rate,
        amountCny: entry.amountCny,
        remark: entry.remark,
        source: 'import',
        importBatchId: batchId,
        importKey: entry.importKey,
        createdById: ctx.actorId,
      }
    })
    const result = await prisma.ledgerEntry.createMany({ data: rows, skipDuplicates: true })
    written += result.count
  }

  logInfo('[LedgerAudit] import.commit', {
    operator: ctx.actorId,
    batchId,
    entries: written,
    importedCny: report.summary.importedCny,
    carryForwardCny: report.summary.carryForwardCny,
  })
  return { ...report, mode: 'commit', batchId }
}

export async function rollbackImport(ctx: LedgerCtx, batchId: string): Promise<{ batchId: string; voided: number }> {
  const result = await prisma.ledgerEntry.updateMany({
    where: { workspaceOwnerId: ctx.ownerId, importBatchId: batchId, voidedAt: null },
    data: { voidedAt: new Date(), voidedById: ctx.actorId, importKey: null },
  })
  logInfo('[LedgerAudit] import.rollback', { operator: ctx.actorId, batchId, voided: result.count })
  return { batchId, voided: result.count }
}
