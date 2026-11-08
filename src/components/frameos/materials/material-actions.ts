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

export async function updateFrameosMaterial(materialId: string, input: { title: string; projectId: string }) {
  const title = input.title.replace(/\s+/g, ' ').trim()
  const projectId = input.projectId.trim()
  if (!title || title.length > 160) throw new Error('素材名称须为 1–160 个字符。')
  if (!projectId || projectId.length > 191) throw new Error('请选择有效的素材归属。')
  const response = await apiFetch(`/api/frameos/materials/${encodeURIComponent(materialId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, projectId }),
  })
  if (!response.ok) throw new Error(await readApiErrorMessage(response, '更新素材失败'))
  const payload = await response.json() as { material?: FrameosMaterialItem; voiceCleared?: boolean; message?: string | null }
  if (!payload.material?.id || payload.material.id !== materialId || !payload.material.title) {
    throw new Error('服务未返回更新后的素材，请刷新后确认。')
  }
  return { ...payload.material, voiceCleared: payload.voiceCleared === true, notice: payload.message || null }
}

export interface MaterialTrashResult {
  materialId: string
  deleted: boolean
  reason: string | null
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
  const payload = await response.json() as {
    success?: boolean
    materialIds?: string[]
    results?: MaterialTrashResult[]
  }
  const results = Array.isArray(payload.results)
    ? payload.results.filter((item) => typeof item?.materialId === 'string' && typeof item.deleted === 'boolean')
    : []
  if (payload.success !== true || results.length !== ids.length
    || new Set(results.map((item) => item.materialId)).size !== ids.length
    || results.some((item) => !ids.includes(item.materialId))) {
    throw new Error('服务未返回完整的逐项删除结果，请刷新后确认。')
  }
  const deletedIds = results.filter((item) => item.deleted).map((item) => item.materialId)
  if (!Array.isArray(payload.materialIds)
    || payload.materialIds.length !== deletedIds.length
    || payload.materialIds.some((id) => !deletedIds.includes(id))) {
    throw new Error('服务返回的删除清单不一致，请刷新后确认。')
  }
  return { deletedIds, skipped: results.filter((item) => !item.deleted), results }
}
