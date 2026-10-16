'use client'

import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { saveProjectDownload, getProjectDownloadDirectory } from '@/lib/media/project-download-directory'
export async function downloadFrameosMaterial(accountId: string, projectId: string, materialId: string) {
  const directory = await getProjectDownloadDirectory(accountId, projectId, true)
  const response = await apiFetch(`/api/frameos/materials/${encodeURIComponent(materialId)}/download`, { cache: 'no-store' })
  if (!response.ok) throw new Error(await readApiErrorMessage(response, '下载素材失败'))
  const encoded = response.headers.get('x-nori-filename')
  if (!encoded) throw new Error('下载服务没有返回文件名')
  return saveProjectDownload(accountId, projectId, decodeURIComponent(encoded), await response.blob(), directory)
}
