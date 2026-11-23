import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { toMoneyNumber } from '@/lib/billing/money'
import { snapshotProjectCostsBeforePurge, syncPlatformFacts } from '@/lib/compute-ledger/sync'
import { forceSync, resetLedgerState, seedUsageCost, seedWorkspace } from './helpers'

describe('compute-ledger platform sync (UsageCost → LedgerDailyFact)', () => {
  beforeEach(async () => {
    await resetLedgerState()
  })

  it('subtracts internal agent records with the two-pass method and links a ledger project to the work', async () => {
    const { owner, member, work, project } = await seedWorkspace()
    await seedUsageCost({ projectId: project.id, userId: member.id, cost: 100, action: 'generate' })
    await seedUsageCost({ projectId: project.id, userId: member.id, cost: 50, action: 'NORI_AGENT_CANVAS' })
    await seedUsageCost({ projectId: project.id, userId: owner.id, cost: 40, action: 'NORI_AGENT_CANVAS' })

    const result = await forceSync(owner.id)
    expect(result.complete).toBe(true)

    const facts = await prisma.ledgerDailyFact.findMany({ where: { workspaceOwnerId: owner.id } })
    expect(facts).toHaveLength(1) // owner's pure-internal spend produces no fact
    expect(facts[0].actorUserId).toBe(member.id)
    expect(toMoneyNumber(facts[0].costCny)).toBe(100) // 150 total − 50 internal
    expect(facts[0].callCount).toBe(1) // 2 calls − 1 internal

    const ledgerProject = await prisma.ledgerProject.findFirst({ where: { workspaceOwnerId: owner.id } })
    expect(ledgerProject?.workId).toBe(work.id)
    expect(facts[0].ledgerProjectId).toBe(ledgerProject?.id)
  })

  it('is idempotent: re-syncing the same usage does not double the snapshot', async () => {
    const { owner, member, project } = await seedWorkspace()
    await seedUsageCost({ projectId: project.id, userId: member.id, cost: 100 })
    await forceSync(owner.id)
    await forceSync(owner.id)
    const facts = await prisma.ledgerDailyFact.findMany({ where: { workspaceOwnerId: owner.id } })
    expect(facts).toHaveLength(1)
    expect(toMoneyNumber(facts[0].costCny)).toBe(100)
  })

  it('never shrinks a snapshot (GREATEST guards against cascade-delete变小)', async () => {
    const { owner, member, project } = await seedWorkspace()
    await seedUsageCost({ projectId: project.id, userId: member.id, cost: 100 })
    await forceSync(owner.id)
    const fact = await prisma.ledgerDailyFact.findFirst({ where: { workspaceOwnerId: owner.id } })
    await prisma.ledgerDailyFact.update({ where: { id: fact!.id }, data: { costCny: 200 } })
    await forceSync(owner.id)
    const after = await prisma.ledgerDailyFact.findFirst({ where: { workspaceOwnerId: owner.id } })
    expect(toMoneyNumber(after!.costCny)).toBe(200)
  })

  it('attributes spend to metadata.quotaUserId rather than the calling account', async () => {
    const { owner, member, project } = await seedWorkspace()
    await seedUsageCost({
      projectId: project.id,
      userId: owner.id,
      cost: 30,
      metadata: JSON.stringify({ quotaUserId: member.id }),
    })
    await forceSync(owner.id)
    const facts = await prisma.ledgerDailyFact.findMany({ where: { workspaceOwnerId: owner.id } })
    expect(facts).toHaveLength(1)
    expect(facts[0].actorUserId).toBe(member.id)
    expect(toMoneyNumber(facts[0].costCny)).toBe(30)
  })

  it('reports complete with no facts when the workspace has no usage costs', async () => {
    const { owner } = await seedWorkspace()
    const result = await syncPlatformFacts(owner.id, { refresh: true })
    expect(result.complete).toBe(true)
    const facts = await prisma.ledgerDailyFact.findMany({ where: { workspaceOwnerId: owner.id } })
    expect(facts).toHaveLength(0)
  })

  it('snapshotProjectCostsBeforePurge captures a single project history before deletion', async () => {
    const { owner, member, project } = await seedWorkspace()
    await seedUsageCost({ projectId: project.id, userId: member.id, cost: 88 })
    await snapshotProjectCostsBeforePurge(project.id)
    const facts = await prisma.ledgerDailyFact.findMany({ where: { workspaceOwnerId: owner.id } })
    expect(facts).toHaveLength(1)
    expect(toMoneyNumber(facts[0].costCny)).toBe(88)
  })
})
