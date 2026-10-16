import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { FrameosMaterialCreatorOption, FrameosMaterialItem } from './contracts'

/** A busy character directory must not hide older scene uploads past page 1. */
export async function fetchAllFrameosMaterials(
  params: URLSearchParams,
  signal?: AbortSignal,
  onCreators?: (creators: FrameosMaterialCreatorOption[]) => void,
) {
  const query = new URLSearchParams(params)
  const items = new Map<string, FrameosMaterialItem>()
  const cursors = new Set<string>()
  for (;;) {
    const response = await apiFetch(`/api/frameos/materials?${query}`, { cache: 'no-store', signal })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载上传素材失败'))
    const payload = await response.json() as { materials?: FrameosMaterialItem[]; creators?: FrameosMaterialCreatorOption[]; pagination?: { nextCursor?: string | null } }
    if (Array.isArray(payload.creators)) onCreators?.(payload.creators)
    for (const item of payload.materials || []) items.set(item.id, item)
    const next = payload.pagination?.nextCursor
    if (!next) return [...items.values()]
    if (cursors.has(next)) throw new Error('素材分页返回了重复游标，请刷新后重试')
    cursors.add(next)
    query.set('cursor', next)
    // Synchronization is a one-time operation, not something to repeat on
    // every page read while browsing the same collection.
    query.delete('sync')
  }
}
