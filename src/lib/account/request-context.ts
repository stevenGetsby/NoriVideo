import { AsyncLocalStorage } from 'node:async_hooks'
import type { AccountPermission } from './permissions'

type AccountRequestContext = {
  permissions: readonly AccountPermission[]
  actorId?: string
  workspaceOwnerId?: string
}
const accountPermissionStorage = new AsyncLocalStorage<AccountRequestContext>()

export function withAccountPermissionContext<T>(
  permissions: readonly AccountPermission[],
  callback: () => T,
): T {
  return accountPermissionStorage.run({ permissions }, callback)
}

export function getAccountPermissionContext(): readonly AccountPermission[] {
  return accountPermissionStorage.getStore()?.permissions || []
}

/** Set only after the session principal has been checked against the database. */
export function setAccountActorContext(actorId: string, workspaceOwnerId: string) {
  const context = accountPermissionStorage.getStore()
  if (context) { context.actorId = actorId; context.workspaceOwnerId = workspaceOwnerId }
}

export function getGenerationQuotaUserId(walletUserId: string) {
  const context = accountPermissionStorage.getStore()
  return context?.workspaceOwnerId === walletUserId && context.actorId ? context.actorId : walletUserId
}

/** Never accept quota ownership from a browser-supplied task payload. */
export function buildTrustedTaskQuotaMeta(walletUserId: string, meta: Record<string, unknown>) {
  const trusted = { ...meta }
  delete trusted.quotaUserId
  const actorId = getGenerationQuotaUserId(walletUserId)
  if (actorId !== walletUserId) trusted.quotaUserId = actorId
  return trusted
}

/** Restore only server-persisted task metadata inside its isolated worker turn. */
export function withTaskQuotaContext<T>(walletUserId: string, taskPayload: unknown, callback: () => T) {
  const payload = taskPayload && typeof taskPayload === 'object' && !Array.isArray(taskPayload)
    ? taskPayload as Record<string, unknown> : {}
  const meta = payload.meta && typeof payload.meta === 'object' && !Array.isArray(payload.meta)
    ? payload.meta as Record<string, unknown> : {}
  const actor = typeof meta.quotaUserId === 'string' && meta.quotaUserId.trim() && meta.quotaUserId.length <= 191
    ? meta.quotaUserId : walletUserId
  return accountPermissionStorage.run({ permissions: [], actorId: actor, workspaceOwnerId: walletUserId }, callback)
}
