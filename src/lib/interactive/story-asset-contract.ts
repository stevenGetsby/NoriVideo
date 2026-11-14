/** Client-safe contract for the pictures a 影游 creator uploads (button, option and prop art). Keep it free of Node-only imports. */
export const STORY_ASSET_MAX_BYTES = 8 * 1024 * 1024
export const STORY_ASSET_MAX_DIMENSION = 12_000
export const STORY_ASSET_FIT_PX = 1280
export const STORY_ASSET_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

export const STORY_ASSET_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])

export function isStoryAssetFileCandidate(file: { type?: string | null; size?: number | null }): boolean {
  const type = (file.type || '').trim().toLowerCase()
  const size = typeof file.size === 'number' ? file.size : 0
  return size > 0 && size <= STORY_ASSET_MAX_BYTES && (!type || STORY_ASSET_MIME_TYPES.has(type))
}
