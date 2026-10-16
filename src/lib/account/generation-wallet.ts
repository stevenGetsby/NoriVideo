import { prisma } from '@/lib/prisma'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { cnyToPoints } from '@/lib/billing/credit-policy'
import { normalizeAccountPointCredit } from './credits'
import { resolveBillingPrincipals, type BillingAccountIdentity } from './billing-identity'

/** Read-only session snapshot of the same wallet that generation will reserve. */
export async function getGenerationWalletPoints(
  account: BillingAccountIdentity & { balance?: { balance: unknown } | null },
) {
  const { walletUserId, actorUserId } = resolveBillingPrincipals(account)
  const wallet = walletUserId === actorUserId
    ? account.balance
    : await withPrismaRetry(() => prisma.userBalance.findUnique({
        where: { userId: walletUserId },
        select: { balance: true },
      }))
  return normalizeAccountPointCredit(cnyToPoints(Number(wallet?.balance || 0)))
}
