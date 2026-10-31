import { getSignedUrl } from '@/lib/storage'
import { isProjectCoverStorageKey } from './project-cover-contract'

/** DB keys never leave the API as raw storage paths; sign them for the UI. */
export function projectCoverImageUrl(key: string | null | undefined): string | null {
  if (!isProjectCoverStorageKey(key)) return null
  return getSignedUrl(key)
}
