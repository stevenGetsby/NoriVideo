import { isManagementRole, normalizeAccountRole } from './permissions'

export type BillingAccountIdentity = {
  id: string
  actorId?: string | null
  role?: string | null
  workspaceOwnerId?: string | null
}

/** Data/charge ownership and personal quota ownership are different principals. */
export function resolveBillingPrincipals(account: BillingAccountIdentity) {
  const actorUserId = account.actorId || account.id
  const walletUserId = isManagementRole(normalizeAccountRole(account.role))
    ? actorUserId
    : account.workspaceOwnerId || account.id
  return {
    actorUserId,
    walletUserId,
    walletScope: walletUserId === actorUserId ? 'personal' as const : 'workspace' as const,
  }
}
