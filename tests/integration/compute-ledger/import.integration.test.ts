import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { ApiError } from '@/lib/api-errors'
import { todayKey } from '@/lib/compute-ledger/calc'
import { rollbackImport, runImport } from '@/lib/compute-ledger/import-service'
import type { ImportPayload } from '@/lib/compute-ledger/import-plan'
import { adminCtx, resetLedgerState, seedWorkspace } from './helpers'

describe('compute-ledger historical import (dry-run → commit → rollback)', () => {
  beforeEach(async () => {
    await resetLedgerState()
  })

  it('dry-run plans without writing, commit is hash-gated and idempotent, rollback soft-voids the batch', async () => {
    const { owner, member } = await seedWorkspace()
    const payload: ImportPayload = {
      rows: [{ rowNo: 1, dateKey: todayKey(), projectName: '导入片', actorName: member.name, apiTokens: 1_000_000, jimengPoints: 0 }],
    }
    const ctx = adminCtx(owner.id)

    const dry = await runImport(ctx, { mode: 'dry-run', carryForward: 'none', payload })
    expect(dry.mode).toBe('dry-run')
    expect(dry.summary.entriesToCreate).toBe(1)
    expect(dry.summary.importedCny).toBe(46)
    expect(dry.summary.actorsMatched).toBe(1)
    expect(await prisma.ledgerEntry.count()).toBe(0)

    await expect(runImport(ctx, { mode: 'commit', carryForward: 'none', payload })).rejects.toBeInstanceOf(ApiError)

    const committed = await runImport(ctx, { mode: 'commit', carryForward: 'none', expectedHash: dry.reportHash, payload })
    expect(committed.mode).toBe('commit')
    expect(committed.batchId).toBeTruthy()
    const entries = await prisma.ledgerEntry.findMany({ where: { workspaceOwnerId: owner.id } })
    expect(entries).toHaveLength(1)
    expect(entries[0].source).toBe('import')
    expect(entries[0].actorUserId).toBe(member.id)
    expect(Number(entries[0].amountCny)).toBe(46)

    const dryAgain = await runImport(ctx, { mode: 'dry-run', carryForward: 'none', payload })
    expect(dryAgain.summary.alreadyImported).toBe(1)
    expect(dryAgain.summary.entriesToCreate).toBe(0)
    await runImport(ctx, { mode: 'commit', carryForward: 'none', expectedHash: dryAgain.reportHash, payload })
    expect(await prisma.ledgerEntry.count({ where: { workspaceOwnerId: owner.id } })).toBe(1)

    const rolled = await rollbackImport(ctx, committed.batchId!)
    expect(rolled.voided).toBe(1)
    const after = await prisma.ledgerEntry.findFirst({ where: { workspaceOwnerId: owner.id } })
    expect(after?.voidedAt).not.toBeNull()
    expect(after?.importKey).toBeNull()
  })

  it('refuses to commit a payload that still has validation errors', async () => {
    const { owner } = await seedWorkspace()
    const payload: ImportPayload = {
      rows: [{ rowNo: 1, dateKey: '2026-02-30', projectName: '导入片', actorName: '某人', apiTokens: 1_000_000, jimengPoints: 0 }],
    }
    const ctx = adminCtx(owner.id)
    const dry = await runImport(ctx, { mode: 'dry-run', carryForward: 'none', payload })
    expect(dry.errors.length).toBeGreaterThan(0)
    await expect(runImport(ctx, { mode: 'commit', carryForward: 'none', expectedHash: dry.reportHash, payload })).rejects.toBeInstanceOf(ApiError)
    expect(await prisma.ledgerEntry.count()).toBe(0)
  })
})
