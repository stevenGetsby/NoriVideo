import { Prisma } from '@prisma/client'
import { normalizeAccountCredit, normalizeAccountPointCredit } from '@/lib/account/credits'
import { cnyToPoints } from '@/lib/billing/credit-policy'
import {
  effectiveAccountPermissions,
  isManagementRole,
  normalizeAccountRole,
} from '@/lib/account/permissions'

export const managedAccountSelect = {
  id: true,
  name: true,
  role: true,
  roleLabel: true,
  status: true,
  permissions: true,
  workspaceOwnerId: true,
  parentAccountId: true,
  coinCredits: true,
  balance: { select: { balance: true } },
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect

export type ManagedAccountRecord = Prisma.UserGetPayload<{
  select: typeof managedAccountSelect
}>

export function serializeManagedAccount(account: ManagedAccountRecord) {
  const role = normalizeAccountRole(account.role)
  return {
    id: account.id,
    username: account.name,
    role,
    roleLabel: isManagementRole(role) ? null : account.roleLabel,
    status: account.status === 'active' ? 'active' as const : 'disabled' as const,
    permissions: effectiveAccountPermissions(role, account.permissions),
    isPlatformAdmin: role === 'super_admin',
    isManager: isManagementRole(role),
    parentAccountId: account.parentAccountId,
    workspaceOwnerId: isManagementRole(role) ? account.id : account.workspaceOwnerId,
    credits: {
      coins: normalizeAccountCredit(account.coinCredits),
      points: normalizeAccountPointCredit(
        account.balance ? cnyToPoints(Number(account.balance.balance)) : 0,
      ),
    },
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
    lastLoginAt: account.lastLoginAt?.toISOString() || null,
  }
}

export function isDirectSubaccountOf(
  account: Pick<ManagedAccountRecord, 'parentAccountId' | 'workspaceOwnerId'>,
  managerId: string,
) {
  return account.parentAccountId === managerId || account.workspaceOwnerId === managerId
}
