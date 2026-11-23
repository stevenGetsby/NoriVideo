/**
 * 算力账本历史回填：把 UsageCost 全量快照进 LedgerDailyFact。
 * 复用 sync.ts 的块函数，31 天一块。--dry-run 只打印不写。
 * 只在本地 dev 库跑；对测试机/生产跑由用户决定。
 *
 *   npx tsx scripts/ledger-backfill.ts --owner <workspaceOwnerId> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]
 *   npx tsx scripts/ledger-backfill.ts --all-owners [--dry-run]
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toMoneyNumber } from '@/lib/billing/money'
import { shanghaiDateKey } from '@/lib/account/activity-stats-shared'
import { addDaysKey, fromMicros, isValidDateKey, todayKey } from '@/lib/compute-ledger/calc'
import { persistFactRows, runFactChunk } from '@/lib/compute-ledger/sync'

const CHUNK_DAYS = 31

function write(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index < 0) return null
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : null
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

async function ownersWithUsage(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ workspaceOwnerId: string }>>(Prisma.sql`
    SELECT DISTINCT w.workspaceOwnerId AS workspaceOwnerId
    FROM usage_costs u
    JOIN projects p ON p.id = u.projectId
    JOIN works w ON w.id = p.workId
  `)
  return rows.map((row) => row.workspaceOwnerId)
}

async function earliestKey(ownerId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ minAt: Date | null }>>(Prisma.sql`
    SELECT MIN(u.createdAt) AS minAt
    FROM usage_costs u
    JOIN projects p ON p.id = u.projectId
    JOIN works w ON w.id = p.workId
    WHERE w.workspaceOwnerId = ${ownerId}
  `)
  const minAt = rows[0]?.minAt
  return minAt ? shanghaiDateKey(minAt) : null
}

async function ledgerTotalCny(ownerId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: unknown }>>(Prisma.sql`
    SELECT SUM(costCny) AS total FROM ledger_daily_facts WHERE workspaceOwnerId = ${ownerId}
  `)
  return toMoneyNumber(rows[0]?.total)
}

async function backfillOwner(ownerId: string, from: string | null, to: string | null, dryRun: boolean) {
  const startKey = from ?? (await earliestKey(ownerId))
  const endKey = to ?? todayKey()
  if (!startKey) {
    write({ owner: ownerId, skipped: 'no usage costs' })
    return
  }
  let cursor = startKey
  let chunks = 0
  let rows = 0
  let micros = 0
  while (cursor <= endKey) {
    const shifted = addDaysKey(cursor, CHUNK_DAYS - 1)
    const chunkEnd = shifted < endKey ? shifted : endKey
    const facts = await runFactChunk(ownerId, cursor, chunkEnd)
    const chunkMicros = facts.reduce((sum, fact) => sum + fact.costMicros, 0)
    chunks += 1
    rows += facts.length
    micros += chunkMicros
    write({ owner: ownerId, chunk: `${cursor}..${chunkEnd}`, rows: facts.length, chunkCny: fromMicros(chunkMicros), dryRun })
    if (!dryRun) await persistFactRows(ownerId, facts)
    cursor = addDaysKey(chunkEnd, 1)
  }
  write({
    owner: ownerId,
    done: true,
    chunks,
    rows,
    processedCny: fromMicros(micros),
    ledgerTotalCny: await ledgerTotalCny(ownerId),
    dryRun,
  })
}

async function main() {
  const dryRun = hasFlag('--dry-run')
  const from = argValue('--from')
  const to = argValue('--to')
  if (from && !isValidDateKey(from)) throw new Error(`--from 非法日期：${from}`)
  if (to && !isValidDateKey(to)) throw new Error(`--to 非法日期：${to}`)
  if (from && to && from > to) throw new Error('--from 不能晚于 --to')

  const owner = argValue('--owner')
  const allOwners = hasFlag('--all-owners')
  let owners: string[]
  if (owner) owners = [owner]
  else if (allOwners) owners = await ownersWithUsage()
  else throw new Error('需要 --owner <id> 或 --all-owners')

  write({ startedAt: new Date().toISOString(), owners: owners.length, dryRun, from, to })
  for (const ownerId of owners) {
    await backfillOwner(ownerId, from, to, dryRun)
  }
  await prisma.$disconnect()
}

main().catch(async (error) => {
  write({ error: error instanceof Error ? error.message : String(error) })
  await prisma.$disconnect()
  process.exitCode = 1
})