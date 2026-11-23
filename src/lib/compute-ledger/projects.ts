/**
 * 账本项目元数据：新建（关联 Work 或外部）、编辑、归档（不提供删除）。
 * 成员「记一笔」下拉只返回 id/名称/类型/状态/是否有预算，不返回金额（D4）。
 */
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { logInfo } from '@/lib/logging/core'
import { toMoneyNumber } from '@/lib/billing/money'
import {
  CATEGORIES,
  PROJECT_STATUSES,
  type Category,
  type ProjectStatus,
  isValidDateKey,
  normalizeProjectName,
  todayKey,
} from './calc'
import type { LedgerCtx } from './route-helpers'

export type ProjectOption = {
  id: string
  name: string
  category: Category | null
  status: ProjectStatus
  hasBudget: boolean
}

export type LedgerProjectInput = {
  name?: string
  workId?: string | null
  category?: Category | null
  status?: ProjectStatus
  startDate?: string | null
  targetDeliveryDate?: string | null
  budgetCny?: number | null
  durationMinutes?: number | null
  totalEpisodes?: number | null
  doneEpisodes?: number | null
  note?: string | null
}

function validateCategory(value: unknown): Category | null {
  if (value == null || value === '') return null
  if (!(CATEGORIES as readonly string[]).includes(String(value))) {
    throw new ApiError('INVALID_PARAMS', { message: '项目类型取值非法。' })
  }
  return value as Category
}

function validateStatus(value: unknown): ProjectStatus {
  if (!(PROJECT_STATUSES as readonly string[]).includes(String(value))) {
    throw new ApiError('INVALID_PARAMS', { message: '项目状态取值非法。' })
  }
  return value as ProjectStatus
}

function validateDate(value: unknown, name: string): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || !isValidDateKey(value)) {
    throw new ApiError('INVALID_PARAMS', { message: `${name} 必须是 YYYY-MM-DD 格式的真实日期。` })
  }
  return value
}

function validateNonNegative(value: unknown, name: string): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) {
    throw new ApiError('INVALID_PARAMS', { message: `${name} 不能为负数。` })
  }
  return num
}

function validateEpisodes(value: unknown, name: string): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  if (!Number.isInteger(num) || num < 0) {
    throw new ApiError('INVALID_PARAMS', { message: `${name} 必须是非负整数。` })
  }
  return num
}

async function findOwnedProject(ctx: LedgerCtx, id: string) {
  const project = await prisma.ledgerProject.findFirst({ where: { id, workspaceOwnerId: ctx.ownerId } })
  if (!project) throw new ApiError('NOT_FOUND', { message: '账本项目不存在。' })
  return project
}

export async function createLedgerProject(ctx: LedgerCtx, input: LedgerProjectInput) {
  let workId: string | null = null
  let name: string
  if (input.workId) {
    const work = await prisma.work.findFirst({
      where: { id: input.workId, workspaceOwnerId: ctx.ownerId, deletedAt: null },
      select: { id: true, name: true },
    })
    if (!work) throw new ApiError('INVALID_PARAMS', { message: '所选作品不存在或不属于当前工作区。' })
    const taken = await prisma.ledgerProject.findFirst({ where: { workspaceOwnerId: ctx.ownerId, workId: work.id } })
    if (taken) throw new ApiError('CONFLICT', { message: '该作品已关联账本项目。' })
    workId = work.id
    name = work.name
  } else {
    name = (input.name ?? '').trim()
    if (!name) throw new ApiError('INVALID_PARAMS', { message: '外部项目必须填写名称。' })
    if (name.length > 191) throw new ApiError('INVALID_PARAMS', { message: '项目名称过长。' })
    const nameKey = normalizeProjectName(name)
    const clash = await prisma.ledgerProject.findFirst({
      where: { workspaceOwnerId: ctx.ownerId, nameKey, archivedAt: null },
    })
    if (clash) throw new ApiError('CONFLICT', { message: '已存在同名的未归档项目。' })
  }

  const totalEpisodes = validateEpisodes(input.totalEpisodes, '总集数')
  const doneEpisodes = validateEpisodes(input.doneEpisodes, '已完成集数')
  if (totalEpisodes != null && doneEpisodes != null && doneEpisodes > totalEpisodes) {
    throw new ApiError('INVALID_PARAMS', { message: '已完成集数不能超过总集数。' })
  }
  const status = input.status ? validateStatus(input.status) : 'in_progress'
  const project = await prisma.ledgerProject.create({
    data: {
      workspaceOwnerId: ctx.ownerId,
      workId,
      name,
      nameKey: normalizeProjectName(name),
      category: validateCategory(input.category),
      status,
      startDate: validateDate(input.startDate, '开工日期'),
      targetDeliveryDate: validateDate(input.targetDeliveryDate, '目标交付日期'),
      completedDate: status === 'completed' ? todayKey() : null,
      budgetCny: validateNonNegative(input.budgetCny, '算力预算'),
      durationMinutes: validateNonNegative(input.durationMinutes, '成片时长'),
      totalEpisodes,
      doneEpisodes,
      note: input.note ? String(input.note).trim().slice(0, 500) : null,
    },
  })
  logInfo('[LedgerAudit] project.create', { operator: ctx.actorId, projectId: project.id, workId, name })
  return project
}

export async function patchLedgerProject(ctx: LedgerCtx, id: string, patch: LedgerProjectInput) {
  const project = await findOwnedProject(ctx, id)
  const data: Record<string, unknown> = {}

  if (patch.name !== undefined) {
    if (project.workId != null) {
      throw new ApiError('INVALID_PARAMS', { message: '关联了平台作品的项目名称跟随作品，不能手动修改。' })
    }
    const name = patch.name.trim()
    if (!name) throw new ApiError('INVALID_PARAMS', { message: '项目名称不能为空。' })
    if (name.length > 191) throw new ApiError('INVALID_PARAMS', { message: '项目名称过长。' })
    const nameKey = normalizeProjectName(name)
    const clash = await prisma.ledgerProject.findFirst({
      where: { workspaceOwnerId: ctx.ownerId, nameKey, archivedAt: null, NOT: { id } },
    })
    if (clash) throw new ApiError('CONFLICT', { message: '已存在同名的未归档项目。' })
    data.name = name
    data.nameKey = nameKey
  }
  if (patch.category !== undefined) data.category = validateCategory(patch.category)
  if (patch.startDate !== undefined) data.startDate = validateDate(patch.startDate, '开工日期')
  if (patch.targetDeliveryDate !== undefined) data.targetDeliveryDate = validateDate(patch.targetDeliveryDate, '目标交付日期')
  if (patch.durationMinutes !== undefined) data.durationMinutes = validateNonNegative(patch.durationMinutes, '成片时长')
  if (patch.note !== undefined) data.note = patch.note ? String(patch.note).trim().slice(0, 500) : null

  if (patch.status !== undefined) {
    const status = validateStatus(patch.status)
    data.status = status
    if (status === 'completed') {
      data.completedDate = project.completedDate ?? todayKey()
    } else {
      data.completedDate = null
    }
  }

  const totalEpisodes = patch.totalEpisodes !== undefined ? validateEpisodes(patch.totalEpisodes, '总集数') : project.totalEpisodes
  const doneEpisodes = patch.doneEpisodes !== undefined ? validateEpisodes(patch.doneEpisodes, '已完成集数') : project.doneEpisodes
  if (totalEpisodes != null && doneEpisodes != null && doneEpisodes > totalEpisodes) {
    throw new ApiError('INVALID_PARAMS', { message: '已完成集数不能超过总集数。' })
  }
  if (patch.totalEpisodes !== undefined) data.totalEpisodes = totalEpisodes
  if (patch.doneEpisodes !== undefined) data.doneEpisodes = doneEpisodes

  if (patch.budgetCny !== undefined) {
    const budget = validateNonNegative(patch.budgetCny, '算力预算')
    const from = project.budgetCny == null ? null : toMoneyNumber(project.budgetCny)
    if (from !== budget) {
      logInfo('[LedgerAudit] project.budget', { operator: ctx.actorId, projectId: id, from, to: budget })
    }
    data.budgetCny = budget
  }

  const updated = await prisma.ledgerProject.update({ where: { id }, data })
  return updated
}

export async function archiveLedgerProject(ctx: LedgerCtx, id: string, archived: boolean) {
  await findOwnedProject(ctx, id)
  const updated = await prisma.ledgerProject.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  })
  logInfo('[LedgerAudit] project.archive', { operator: ctx.actorId, projectId: id, archived })
  return updated
}

async function memberCanSeeWork(ownerId: string, actorId: string, workId: string): Promise<boolean> {
  const work = await prisma.work.findFirst({
    where: {
      id: workId,
      workspaceOwnerId: ownerId,
      deletedAt: null,
      OR: [{ createdById: actorId }, { members: { some: { userId: actorId } } }],
    },
    select: { id: true },
  })
  return !!work
}

/** 成员「记一笔」下拉：未归档、按可见性过滤、不含金额。 */
export async function listProjectOptions(ctx: LedgerCtx): Promise<ProjectOption[]> {
  const projects = await prisma.ledgerProject.findMany({
    where: { workspaceOwnerId: ctx.ownerId, archivedAt: null },
    orderBy: { createdAt: 'asc' },
  })
  const options: ProjectOption[] = []
  for (const project of projects) {
    if (!ctx.isAdmin && project.workId != null) {
      if (!(await memberCanSeeWork(ctx.ownerId, ctx.actorId, project.workId))) continue
    }
    options.push({
      id: project.id,
      name: project.name,
      category: (project.category as Category | null) ?? null,
      status: project.status as ProjectStatus,
      hasBudget: project.budgetCny != null && toMoneyNumber(project.budgetCny) > 0,
    })
  }
  return options
}

/** 还没有账本项目的 Work，供管理员「新建」时选择关联。 */
export async function listWorkCandidates(ctx: LedgerCtx) {
  const linked = await prisma.ledgerProject.findMany({
    where: { workspaceOwnerId: ctx.ownerId, workId: { not: null } },
    select: { workId: true },
  })
  const linkedIds = linked.map((row) => row.workId).filter((id): id is string => !!id)
  const works = await prisma.work.findMany({
    where: { workspaceOwnerId: ctx.ownerId, deletedAt: null, ...(linkedIds.length ? { id: { notIn: linkedIds } } : {}) },
    select: { id: true, name: true },
    orderBy: { updatedAt: 'desc' },
  })
  return works
}