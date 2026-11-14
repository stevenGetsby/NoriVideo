import { apiFetch } from '@/lib/api-fetch'
import { STORY_ASSET_ACCEPT, STORY_ASSET_MAX_BYTES } from '@/lib/interactive/story-asset-contract'
import { storyErrorMessage } from './story-api-error'

export { STORY_ASSET_ACCEPT, STORY_ASSET_MAX_BYTES }

/** Uploads a button / option / prop picture of a 影游 and returns the URL to store in the node data. */
export async function uploadStoryAsset(workId: string, file: File): Promise<{ url: string }> {
  if (file.size > STORY_ASSET_MAX_BYTES) throw new Error('图片不能超过 8MB')
  const body = new FormData()
  body.append('file', file)
  const response = await apiFetch(`/api/interactive/${encodeURIComponent(workId)}/assets`, { method: 'POST', body })
  if (!response.ok) throw new Error(await storyErrorMessage(response, '上传图片失败'))
  const payload = await response.json().catch(() => null) as { url?: unknown } | null
  if (typeof payload?.url !== 'string' || !payload.url) throw new Error('上传图片失败：服务器没有返回图片地址')
  return { url: payload.url }
}
