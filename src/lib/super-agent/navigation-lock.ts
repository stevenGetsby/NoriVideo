const SUPER_AGENT_NAVIGATION_LOCK_PREFIX = 'nori:super-agent-running:'
const SUPER_AGENT_NAVIGATION_LOCK_TTL_MS = 5 * 60 * 1000

function lockKey(projectId: string): string {
  return `${SUPER_AGENT_NAVIGATION_LOCK_PREFIX}${projectId}`
}

function readStorageValue(projectId: string): string | null {
  if (typeof window === 'undefined') return null
  const key = lockKey(projectId)
  try {
    return window.sessionStorage?.getItem(key) || null
  } catch {
    return null
  }
}

function writeStorageValue(projectId: string, value: string): void {
  if (typeof window === 'undefined') return
  const key = lockKey(projectId)
  try {
    window.sessionStorage?.setItem(key, value)
  } catch {
    // Ignore browser storage failures.
  }
}

function removeStorageValue(projectId: string): void {
  if (typeof window === 'undefined') return
  const key = lockKey(projectId)
  try {
    window.sessionStorage?.removeItem(key)
  } catch {
    // Ignore browser storage failures.
  }
}

export function setSuperAgentNavigationLock(projectId: string | null | undefined): void {
  if (!projectId) return
  writeStorageValue(projectId, String(Date.now()))
}

export function clearSuperAgentNavigationLock(projectId: string | null | undefined): void {
  if (!projectId) return
  removeStorageValue(projectId)
}

export function isSuperAgentNavigationLocked(projectId: string | null | undefined): boolean {
  if (!projectId) return false
  const rawValue = readStorageValue(projectId)
  if (!rawValue) return false
  const timestamp = Number(rawValue)
  if (!Number.isFinite(timestamp)) return false
  const isFresh = Date.now() - timestamp < SUPER_AGENT_NAVIGATION_LOCK_TTL_MS
  if (!isFresh) {
    removeStorageValue(projectId)
  }
  return isFresh
}
