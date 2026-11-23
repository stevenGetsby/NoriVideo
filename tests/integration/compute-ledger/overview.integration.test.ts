import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { todayKey } from '@/lib/compute-ledger/calc'
import { createEntry } from '@/lib/compute-ledger/entries'
import { getOverview } from '@/lib/compute-ledger/overview'
import { adminCtx, forceSync, resetLedgerState, seedUsageCost, seedWorkspace } from './helpers'

describe('compute-ledger admin overview aggregation', () => {
  beforeEach(async () => {
    await resetLedgerState()
  })

  it('merges platform facts and manual entries, derives budget level, and keeps archived totals', async () => {
    const { owner, member, work, project } = await seedWorkspace()
    await seedUsageCost({ projectId: project.id, userId: member.id, cost: 85 })
    await forceSync(owner.id)

    const ledgerProject = await prisma.ledgerProject.findFirst({ where: { workspaceOwnerId: owner.id, workId: work.id } })
    await prisma.ledgerProject.update({ where: { id: ledgerProject!.id }, data: { budgetCny: 100 } })

    const warn = await getOverview(owner.id, {})
    const warnRow = warn.rows.find((row) => row.projectId === ledgerProject!.id)!
    expect(warnRow.totalCny).toBe(85)
    expect(warnRow.level).toBe('warn')
    expect(warnRow.remainingCny).toBe(15)
    expect(warnRow.platformCny).toBe(85)

    await createEntry(adminCtx(owner.id), {
      ledgerProjectId: ledgerProject!.id, dateKey: todayKey(), kind: 'other_cny', quantity: 20, remark: '外部渲染',
    })

    const over = await getOverview(owner.id, {})
    const overRow = over.rows.find((row) => row.projectId === ledgerProject!.id)!
    expect(overRow.totalCny).toBe(105)
    expect(overRow.externalCny).toBe(20)
    expect(overRow.level).toBe('over')
    expect(overRow.remainingCny).toBe(-5)
    expect(overRow.byActor).toHaveLength(2) // member (platform) + owner (manual)
    expect(over.totals.totalCny).toBe(105)
    expect(over.totals.overCount).toBe(1)

    await prisma.ledgerProject.update({ where: { id: ledgerProject!.id }, data: { archivedAt: new Date() } })
    const hidden = await getOverview(owner.id, {})
    expect(hidden.rows.some((row) => row.projectId === ledgerProject!.id)).toBe(false)
    expect(hidden.totals.totalCny).toBe(105) // archived still counted in totals
    const shown = await getOverview(owner.id, { includeArchived: true })
    expect(shown.rows.some((row) => row.projectId === ledgerProject!.id)).toBe(true)
  })

  it('filters by category and status', async () => {
    const { owner } = await seedWorkspace()
    const a = await prisma.ledgerProject.create({ data: { workspaceOwnerId: owner.id, name: '精品片', nameKey: '精品片', category: 'premium', status: 'in_progress' } })
    await prisma.ledgerProject.create({ data: { workspaceOwnerId: owner.id, name: '短片', nameKey: '短片', category: 'short', status: 'completed' } })
    const premium = await getOverview(owner.id, { category: 'premium' })
    expect(premium.rows.map((row) => row.projectId)).toEqual([a.id])
    const completed = await getOverview(owner.id, { status: 'completed' })
    expect(completed.rows.every((row) => row.status === 'completed')).toBe(true)
    expect(completed.rows).toHaveLength(1)
  })
})
