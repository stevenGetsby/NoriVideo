'use client'

import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { saveProjectDownload, getProjectDownloadDirectory } from '@/lib/media/project-download-directory'
export async function downloadFrameosMaterial(accountId: string, projectId: string, materialId: string) {
  const directory = await getProjectDownloadDirectory(accountId, projectId, true)
  const base = `/api/frameos/materials/${encodeURIComponent(materialId)}/download`

  // Prefer fetching straight from object storage; until the bucket has CORS
  // configured the direct fetch throws and we fall back to the server proxy.
  try {
    const meta = await apiFetch(`${base}?mode=url`, { cache: 'no-store' })
    if (meta.ok) {
      const { url, filename } = await meta.json() as { url: string; filename: string }
      const direct = await fetch(url)
      if (!direct.ok) throw new Error(`HTTP ${direct.status}`)
      return saveProjectDownload(accountId, projectId, filename, await direct.blob(), directory)
    }
  } catch (error) {
    console.warn('素材直连下载失败，回退服务器转发', error)
  }

  const response = await apiFetch(base, { cache: 'no-store' })
  if (!response.ok) throw new Error(await readApiErrorMessage(response, '下载素材失败'))
  const encoded = response.headers.get('x-nori-filename')
  if (!encoded) throw new Error('下载服务没有返回文件名')
  return saveProjectDownload(accountId, projectId, decodeURIComponent(encoded), await response.blob(), directory)
}
