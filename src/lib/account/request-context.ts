import { AsyncLocalStorage } from 'node:async_hooks'
import type { AccountPermission } from './permissions'

const accountPermissionStorage = new AsyncLocalStorage<readonly AccountPermission[]>()

export function withAccountPermissionContext<T>(
  permissions: readonly AccountPermission[],
  callback: () => T,
): T {
  return accountPermissionStorage.run(permissions, callback)
}

export function getAccountPermissionContext(): readonly AccountPermission[] {
  return accountPermissionStorage.getStore() || []
}
