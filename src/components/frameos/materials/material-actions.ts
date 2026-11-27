import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { isImageUpload, MAX_MATERIAL_FILE_BYTES } from '@/lib/frameos/upload-file-policy'
import type { FrameosMaterialItem } from './contracts'

export interface MaterialCanvasSync {
  nodes: number
  canvases: Array<{ projectId: string; canvasId: string; revision: number }>
}

export function readCanvasSync(value: unknown): MaterialCanvasSync | null {
  if (!value || typeof value !== 'object') return null
  const source = value as { nodes?: unknown; canvases?: unknown }
  const nodes = typeof source.nodes === 'number' && Number.isFinite(source.nodes) ? Math.max(0, Math.floor(source.nodes)) : 0
  const canvases = Array.isArray(source.canvases)
    ? source.canvases.filter((item): item is MaterialCanvasSync['canvases'][number] => Boolean(item)
      && typeof item.projectId === 'string' && typeof item.canvasId === 'string' && typeof item.revision === 'number')
    : []
  return nodes > 0 && canvases.length > 0 ? { nodes, canvases } : null
}

export function describeCanvasSync(sync: MaterialCanvasSync | null | undefined) {
  return sync ? `已同步更新 ${sync.canvases.length} 个画布中的 ${sync.nodes} 个节点。` : null
}

export async function renameFrameosMaterial(materialId: string, value: string) {
  const title = value.replace(/\s+/g, ' ').trim()
  if (!title || title.length > 160) throw new Error('素材名称须为 1–160 个字符。')
  const response = await apiFetch(`/api/frameos/materials/${encodeURIComponent(materialId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!response.ok) throw new Error(await readApiErrorMessage(response, '重命名素材失败'))
  const payload = await response.json() as { material?: FrameosMaterialItem; canvasSync?: unknown }
  if (!payload.material?.id || payload.material.id !== materialId || !payload.material.title) {
    throw new Error('服务未返回更新后的素材，请刷新后确认。')
  }
  return { ...payload.material, canvasSync: readCanvasSync(payload.canvasSync) }
}

export async function updateFrameosMaterial(materialId: string, input: { title?: string; projectId: string }) {
  const title = input.title === undefined ? undefined : input.title.replace(/\s+/g, ' ').trim()
  const projectId = input.projectId.trim()
  if (title !== undefined && (!title || title.length > 160)) throw new Error('素材名称须为 1–160 个字符。')
  if (!projectId || projectId.length > 191) throw new Error('请选择有效的素材归属。')
  const response = await apiFetch(`/api/frameos/materials/${encodeURIComponent(materialId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(title === undefined ? { projectId } : { title, projectId }),
  })
  if (!response.ok) throw new Error(await readApiErrorMessage(response, '更新素材失败'))
  const payload = await response.json() as { material?: FrameosMaterialItem; voiceCleared?: boolean; message?: string | null; canvasSync?: unknown }
  if (!payload.material?.id || payload.material.id !== materialId || (title !== undefined && !payload.material.title)) {
    throw new Error('服务未返回更新后的素材，请刷新后确认。')
  }
  return { ...payload.material, voiceCleared: payload.voiceCleared === true, notice: payload.message || null, canvasSync: readCanvasSync(payload.canvasSync) }
}

export interface MaterialImageReplaceResult {
  material: FrameosMaterialItem
  previousMaterialId: string
  retired: 'trashed' | 'superseded'
  referenceCount: number
  voiceKept: boolean
  voiceDropped: boolean
}

export function describeMaterialImageReplacement(name: string, result: Pick<MaterialImageReplaceResult, 'retired' | 'referenceCount' | 'voiceKept' | 'voiceDropped'>) {
  const parts = [`已替换「${name}」的图片。`]
  if (result.voiceKept) parts.push('角色音色已保持绑定，无需重新上传音频。')
  if (result.voiceDropped) parts.push('原绑定的音色已不可用，请重新设置角色音色。')
  parts.push(result.retired === 'superseded'
    ? `仍有 ${Math.max(1, result.referenceCount)} 个画布或工作流模板在使用原图片，它们会继续按原图片生成；需要时请在画布中手动更换。`
    : '原图片已移入回收站，可随时恢复。')
  return parts.join('')
}

export async function replaceFrameosMaterialImage(materialId: string, file: File): Promise<MaterialImageReplaceResult> {
  if (!isImageUpload(file)) throw new Error('请选择图片文件（JPG、PNG、WebP 等）。')
  if (file.size <= 0 || file.size > MAX_MATERIAL_FILE_BYTES) throw new Error('素材文件大小必须在 200MB 以内。')
  const form = new FormData()
  form.append('file', file)
  const response = await apiFetch(`/api/frameos/materials/${encodeURIComponent(materialId)}/replace-image`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) throw new Error(await readApiErrorMessage(response, '替换图片失败'))
  const payload = await response.json() as {
    success?: boolean
    material?: FrameosMaterialItem
    previousMaterialId?: string
    retired?: string
    referenceCounts?: { currentCanvases?: number; workflowTemplates?: number }
    voiceKept?: boolean
    voiceDropped?: boolean
  }
  if (payload.success !== true || !payload.material?.id || payload.material.id === materialId
    || payload.previousMaterialId !== materialId
    || (payload.retired !== 'trashed' && payload.retired !== 'superseded')) {
    throw new Error('服务未返回替换后的素材，请刷新后确认。')
  }
  return {
    material: payload.material,
    previousMaterialId: payload.previousMaterialId,
    retired: payload.retired,
    referenceCount: Math.max(0, Math.floor(Number(payload.referenceCounts?.currentCanvases) || 0))
      + Math.max(0, Math.floor(Number(payload.referenceCounts?.workflowTemplates) || 0)),
    voiceKept: payload.voiceKept === true,
    voiceDropped: payload.voiceDropped === true,
  }
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
