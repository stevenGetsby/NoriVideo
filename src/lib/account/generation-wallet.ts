import { cnyToPoints } from '@/lib/billing/credit-policy'
import { normalizeAccountPointCredit } from './credits'
import type { BillingAccountIdentity } from './billing-identity'

/** Read-only session snapshot of the same wallet that generation will reserve. */
export async function getGenerationWalletPoints(
  account: BillingAccountIdentity & { balance?: { balance: unknown } | null },
) {
  return normalizeAccountPointCredit(cnyToPoints(Number(account.balance?.balance || 0)))
}
