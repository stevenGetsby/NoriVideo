/**
 * Client-safe cover image contract. Keep this module free of Node-only imports
 * so the projects UI can validate a selected file before uploading it.
 */
export const PROJECT_COVER_MAX_BYTES = 8 * 1024 * 1024
export const PROJECT_COVER_MAX_DIMENSION = 12_000
export const PROJECT_COVER_ACCEPT = 'image/jpeg,image/png,image/webp'
export const PROJECT_COVER_KEY_PREFIX = 'images/project-cover-'

export const PROJECT_COVER_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

export function isProjectCoverFileCandidate(file: { type?: string | null; size?: number | null }): boolean {
  const type = (file.type || '').trim().toLowerCase()
  const size = typeof file.size === 'number' ? file.size : 0
  return size > 0
    && size <= PROJECT_COVER_MAX_BYTES
    && (!type || PROJECT_COVER_MIME_TYPES.has(type))
}

/** Only keys produced by the cover upload path may be signed or deleted. */
export function isProjectCoverStorageKey(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const key = value.trim()
  if (!key || key.length > 512) return false
  if (!key.startsWith(PROJECT_COVER_KEY_PREFIX)) return false
  if (key.includes('..') || key.includes('\\') || key.startsWith('/') || key.includes('://')) return false
  return /^images\/project-cover-[A-Za-z0-9_-]+\.jpg$/.test(key)
}
