import { PrismaClient } from '@prisma/client'
import { normalizeAccountPointCredit } from '../src/lib/account/credits'
import { pointsToCny } from '../src/lib/billing/credit-policy'

const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({
    where: { balance: null },
    select: { id: true, name: true, pointCredits: true },
  })

  for (const user of users) {
    const legacyPoints = normalizeAccountPointCredit(user.pointCredits)
    const initialBalance = pointsToCny(legacyPoints)
    await prisma.$transaction(async (tx) => {
      const existing = await tx.userBalance.findUnique({ where: { userId: user.id } })
      if (existing) return
      await tx.userBalance.create({
        data: {
          userId: user.id,
          balance: initialBalance,
          frozenAmount: 0,
          totalSpent: 0,
        },
      })
      if (initialBalance !== 0) {
        await tx.balanceTransaction.create({
          data: {
            userId: user.id,
            type: 'legacy_migration',
            amount: initialBalance,
            balanceAfter: initialBalance,
            description: JSON.stringify({
              operation: 'legacy_migration',
              points: legacyPoints,
              note: '旧积分字段迁移至统一钱包',
            }),
            idempotencyKey: `wallet-backfill-v1:${user.id}`,
          },
        })
      }
    })
  }

  process.stdout.write(`Wallet reconciliation complete: ${users.length} account(s) initialized.\n`)
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
