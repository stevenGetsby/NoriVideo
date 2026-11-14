import { isManagementRole, normalizeAccountRole } from './permissions'

export type BillingAccountIdentity = {
  id: string
  actorId?: string | null
  role?: string | null
  workspaceOwnerId?: string | null
}

/**
 * The actor pays for their own generation. `ownerUserId` is the manager
 * account a member belongs to, used only for display and funding checks.
 */
export function resolveBillingPrincipals(account: BillingAccountIdentity) {
  const actorUserId = account.actorId || account.id
  const ownerUserId = isManagementRole(normalizeAccountRole(account.role))
    ? actorUserId
    : account.workspaceOwnerId || account.id
  return {
    walletUserId: actorUserId,
    actorUserId,
    ownerUserId,
    isMember: actorUserId !== ownerUserId,
  }
}
