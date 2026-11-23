import { randomUUID } from 'node:crypto'
import { prisma } from '../../helpers/prisma'
import type { LedgerCtx } from '@/lib/compute-ledger/route-helpers'

export async function resetLedgerState() {
  await prisma.ledgerEntry.deleteMany()
  await prisma.ledgerDailyFact.deleteMany()
  await prisma.ledgerProject.deleteMany()
  await prisma.ledgerSetting.deleteMany()
  await prisma.usageCost.deleteMany()
  await prisma.balanceTransaction.deleteMany()
  await prisma.balanceFreeze.deleteMany()
  await prisma.taskEvent.deleteMany()
  await prisma.task.deleteMany()
  await prisma.userBalance.deleteMany()
  await prisma.workMember.deleteMany()
  await prisma.project.deleteMany()
  await prisma.work.deleteMany()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.userPreference.deleteMany()
  await prisma.user.updateMany({ data: { parentAccountId: null } })
  await prisma.user.deleteMany()
}

export async function seedWorkspace() {
  const suffix = randomUUID().slice(0, 8)
  const owner = await prisma.user.create({
    data: { name: `ledger_owner_${suffix}`, email: `ledger_owner_${suffix}@example.com`, role: 'admin' },
  })
  const member = await prisma.user.create({
    data: { name: `ledger_member_${suffix}`, email: `ledger_member_${suffix}@example.com`, role: 'writer', workspaceOwnerId: owner.id },
  })
  const work = await prisma.work.create({
    data: { name: `Ledger Work ${suffix}`, workspaceOwnerId: owner.id, createdById: owner.id },
  })
  const project = await prisma.project.create({
    data: { name: `Ledger Project ${suffix}`, userId: owner.id, createdById: owner.id, workId: work.id },
  })
  await prisma.workMember.create({ data: { workId: work.id, userId: member.id } })
  return { owner, member, work, project }
}

export function adminCtx(ownerId: string): LedgerCtx {
  return { ownerId, actorId: ownerId, isAdmin: true }
}

export function memberCtx(ownerId: string, actorId: string): LedgerCtx {
  return { ownerId, actorId, isAdmin: false }
}

export async function seedExternalProject(ownerId: string, name = '外部项目') {
  return prisma.ledgerProject.create({
    data: { workspaceOwnerId: ownerId, name, nameKey: name.toLowerCase(), workId: null },
  })
}

export async function seedUsageCost(params: {
  projectId: string
  userId: string
  cost: number
  apiType?: string
  action?: string
  model?: string
  metadata?: string | null
  createdAt?: Date
}) {
  return prisma.usageCost.create({
    data: {
      projectId: params.projectId,
      userId: params.userId,
      apiType: params.apiType ?? 'image',
      model: params.model ?? 'test-model',
      action: params.action ?? 'generate',
      quantity: 1,
      unit: 'call',
      cost: params.cost,
      metadata: params.metadata ?? null,
      createdAt: params.createdAt ?? new Date(),
    },
  })
}

/** Bypass the read throttle so a test can force a fresh sync pass. */
export async function forceSync(ownerId: string, maxChunks = 6) {
  await prisma.ledgerSetting.updateMany({
    where: { workspaceOwnerId: ownerId },
    data: { lastSyncAt: null, syncLockedUntil: null, syncedThroughDate: null },
  })
  const { syncPlatformFacts } = await import('@/lib/compute-ledger/sync')
  return syncPlatformFacts(ownerId, { refresh: true, maxChunks })
}
