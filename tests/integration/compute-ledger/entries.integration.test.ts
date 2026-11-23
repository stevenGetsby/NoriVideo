import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { ApiError } from '@/lib/api-errors'
import { addDaysKey, todayKey } from '@/lib/compute-ledger/calc'
import { createEntry, replaceEntry, voidEntry } from '@/lib/compute-ledger/entries'
import { adminCtx, memberCtx, resetLedgerState, seedExternalProject, seedWorkspace } from './helpers'

async function expectApiError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ApiError)
  await promise.catch((error: ApiError) => expect(error.code).toBe(code))
}

describe('compute-ledger manual entries', () => {
  beforeEach(async () => {
    await resetLedgerState()
  })

  it('computes amount server-side from the current rate (api_token 1e6 × 46 = ¥46)', async () => {
    const { owner } = await seedWorkspace()
    const project = await seedExternalProject(owner.id)
    const entry = await createEntry(adminCtx(owner.id), {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'api_token', quantity: 1_000_000,
    })
    expect(entry.amountCny).toBe(46)
    expect(entry.rate).toBe(46)
    expect(entry.actorUserId).toBe(owner.id)
    expect(entry.source).toBe('manual')
  })

  it('lets a member record against an external project as themselves', async () => {
    const { owner, member } = await seedWorkspace()
    const project = await seedExternalProject(owner.id)
    const entry = await createEntry(memberCtx(owner.id, member.id), {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'jimeng_points', quantity: 100,
    })
    expect(entry.actorUserId).toBe(member.id)
    expect(entry.amountCny).toBe(10)
  })

  it('rejects a member backdate older than 14 days', async () => {
    const { owner, member } = await seedWorkspace()
    const project = await seedExternalProject(owner.id)
    await expectApiError(createEntry(memberCtx(owner.id, member.id), {
      ledgerProjectId: project.id, dateKey: addDaysKey(todayKey(), -20), kind: 'api_token', quantity: 1_000_000,
    }), 'INVALID_PARAMS')
  })

  it('forbids a member from voiding another actor’s entry', async () => {
    const { owner, member } = await seedWorkspace()
    const project = await seedExternalProject(owner.id)
    const entry = await createEntry(adminCtx(owner.id), {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'api_token', quantity: 1_000_000,
    })
    await expectApiError(voidEntry(memberCtx(owner.id, member.id), entry.id), 'FORBIDDEN')
  })

  it('soft-voids a member’s own entry without deleting the row (R7)', async () => {
    const { owner, member } = await seedWorkspace()
    const project = await seedExternalProject(owner.id)
    const entry = await createEntry(memberCtx(owner.id, member.id), {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'api_token', quantity: 1_000_000,
    })
    await voidEntry(memberCtx(owner.id, member.id), entry.id)
    const row = await prisma.ledgerEntry.findUnique({ where: { id: entry.id } })
    expect(row).not.toBeNull()
    expect(row?.voidedAt).not.toBeNull()
  })

  it('replaceEntry voids the old row and links the new one via replacesEntryId', async () => {
    const { owner } = await seedWorkspace()
    const project = await seedExternalProject(owner.id)
    const old = await createEntry(adminCtx(owner.id), {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'api_token', quantity: 1_000_000,
    })
    const next = await replaceEntry(adminCtx(owner.id), old.id, {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'api_token', quantity: 2_000_000,
    })
    expect(next.amountCny).toBe(92)
    expect(next.replacesEntryId).toBe(old.id)
    const oldRow = await prisma.ledgerEntry.findUnique({ where: { id: old.id } })
    expect(oldRow?.voidedAt).not.toBeNull()
  })

  it('blocks a member’s oversized amount but lets an admin confirm it', async () => {
    const { owner, member } = await seedWorkspace()
    const project = await seedExternalProject(owner.id)
    await expectApiError(createEntry(memberCtx(owner.id, member.id), {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'other_cny', quantity: 200_000,
    }), 'INVALID_PARAMS')
    const entry = await createEntry(adminCtx(owner.id), {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'other_cny', quantity: 200_000, confirmLarge: true,
    })
    expect(entry.amountCny).toBe(200_000)
  })

  it('requires a remark for an admin negative calibration entry', async () => {
    const { owner } = await seedWorkspace()
    const project = await seedExternalProject(owner.id)
    await expectApiError(createEntry(adminCtx(owner.id), {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'other_cny', quantity: -5,
    }), 'INVALID_PARAMS')
    const entry = await createEntry(adminCtx(owner.id), {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'other_cny', quantity: -5, remark: '冲销多记',
    })
    expect(entry.amountCny).toBe(-5)
  })

  it('snapshots the rate at record time: later rate changes do not rewrite old entries', async () => {
    const { owner } = await seedWorkspace()
    const project = await seedExternalProject(owner.id)
    const first = await createEntry(adminCtx(owner.id), {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'api_token', quantity: 1_000_000,
    })
    await prisma.ledgerSetting.update({ where: { workspaceOwnerId: owner.id }, data: { tokenRateCnyPerMillion: 50 } })
    const second = await createEntry(adminCtx(owner.id), {
      ledgerProjectId: project.id, dateKey: todayKey(), kind: 'api_token', quantity: 1_000_000,
    })
    expect(first.amountCny).toBe(46)
    expect(second.amountCny).toBe(50)
    const firstRow = await prisma.ledgerEntry.findUnique({ where: { id: first.id } })
    expect(Number(firstRow?.rate)).toBe(46)
  })

  it('forbids a member from editing an import-source entry', async () => {
    const { owner, member } = await seedWorkspace()
    const project = await seedExternalProject(owner.id)
    const imported = await prisma.ledgerEntry.create({
      data: {
        workspaceOwnerId: owner.id, ledgerProjectId: project.id, dateKey: todayKey(),
        actorUserId: member.id, actorLabel: member.name, kind: 'api_token',
        quantity: 1_000_000, rate: 46, amountCny: 46, source: 'import',
        importKey: 'imp1:test-key', importBatchId: 'batch-1', createdById: owner.id,
      },
    })
    await expectApiError(voidEntry(memberCtx(owner.id, member.id), imported.id), 'FORBIDDEN')
  })
})
