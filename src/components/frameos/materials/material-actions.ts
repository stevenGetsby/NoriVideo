import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { FrameosMaterialItem } from './contracts'

export async function renameFrameosMaterial(materialId: string, value: string) {
  const title = value.replace(/\s+/g, ' ').trim()
  if (!title || title.length > 160) throw new Error('素材名称须为 1–160 个字符。')
  const response = await apiFetch(`/api/frameos/materials/${encodeURIComponent(materialId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!response.ok) throw new Error(await readApiErrorMessage(response, '重命名素材失败'))
  const payload = await response.json() as { material?: FrameosMaterialItem }
  if (!payload.material?.id || payload.material.id !== materialId || !payload.material.title) {
    throw new Error('服务未返回更新后的素材，请刷新后确认。')
  }
  return payload.material
}

export async function trashFrameosMaterials(materialIds: readonly string[]) {
  const ids = Array.from(new Set(materialIds))
  if (!ids.length || ids.length > 200) throw new Error('每次请选择 1–200 个上传素材。')
  const response = await apiFetch('/api/frameos/materials/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materialIds: ids }),
  })
  if (!response.ok) throw new Error(await readApiErrorMessage(response, '批量删除素材失败'))
  const payload = await response.json() as { success?: boolean }
  if (payload.success !== true) throw new Error('服务未确认删除成功，请刷新后重试。')
}
