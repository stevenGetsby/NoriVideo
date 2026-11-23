import { AsyncLocalStorage } from 'node:async_hooks'
import { logWarn } from '@/lib/logging/core'
import type { AccountPermission } from './permissions'

type AccountRequestContext = {
  permissions: readonly AccountPermission[]
  actorId?: string
  workspaceOwnerId?: string
  routeProjectId?: string
  routePathname?: string
}
const accountPermissionStorage = new AsyncLocalStorage<AccountRequestContext>()

export function withAccountPermissionContext<T>(
  permissions: readonly AccountPermission[],
  callback: () => T,
  routeProjectId?: string,
  routePathname?: string,
): T {
  return accountPermissionStorage.run({ permissions, routeProjectId, routePathname }, callback)
}

export function getAccountPermissionContext(): readonly AccountPermission[] {
  return accountPermissionStorage.getStore()?.permissions || []
}

/** The 作品 id named by the route path or `?projectId=`, checked against 作品 visibility at auth time. */
export function getRouteProjectIdContext(): string | undefined {
  return accountPermissionStorage.getStore()?.routeProjectId
}

export function getRoutePathnameContext(): string | undefined {
  return accountPermissionStorage.getStore()?.routePathname
}

/** Set only after the session principal has been checked against the database. */
export function setAccountActorContext(actorId: string, workspaceOwnerId: string) {
  const context = accountPermissionStorage.getStore()
  if (context) { context.actorId = actorId; context.workspaceOwnerId = workspaceOwnerId }
}

/**
 * The wallet that pays for a generation. The ALS context is populated at auth
 * time for every API request; a missing context means a billing path bypassed
 * apiHandler, so log it for post-release monitoring.
 */
export function resolveGenerationPayerId(walletUserId: string) {
  const context = accountPermissionStorage.getStore()
  if (!context) {
    logWarn('[Billing] payer resolved without actor context', { walletUserId })
    return walletUserId
  }
  return context.workspaceOwnerId === walletUserId && context.actorId ? context.actorId : walletUserId
}

/** Never accept quota ownership from a browser-supplied task payload. */
export function buildTrustedTaskQuotaMeta(walletUserId: string, meta: Record<string, unknown>) {
  const trusted = { ...meta }
  delete trusted.quotaUserId
  const payerId = resolveGenerationPayerId(walletUserId)
  if (payerId !== walletUserId) trusted.quotaUserId = payerId
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
