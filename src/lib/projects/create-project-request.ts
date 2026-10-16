'use client'

import { getPageLocale } from '@/lib/api-fetch'
import type { ProjectStyleReferenceDraftFile } from './style-reference-contract'

export type ProjectStyleReferenceUploadStatus = 'idle' | 'uploading' | 'processing' | 'uploaded' | 'failed'

export interface ProjectStyleReferenceProgressUpdate {
  id: string
  progress: number
  status: ProjectStyleReferenceUploadStatus
  error?: string | null
}

export function calculateStyleReferenceUploadProgress(
  loaded: number,
  total: number,
  references: Array<Pick<ProjectStyleReferenceDraftFile, 'id' | 'file'>>,
): ProjectStyleReferenceProgressUpdate[] {
  const fileBytes = references.reduce((sum, item) => sum + Math.max(1, item.file.size), 0)
  // The project form appends reference files last. Subtract the preceding form
  // bytes so a large script upload does not falsely advance every reference.
  const precedingBytes = total > 0 ? Math.max(0, total - fileBytes) : 0
  const estimatedFileBytes = Math.min(fileBytes, Math.max(0, loaded - precedingBytes))
  let byteOffset = 0

  return references.map((item) => {
    const size = Math.max(1, item.file.size)
    const itemProgress = Math.min(99, Math.max(0, Math.round(((estimatedFileBytes - byteOffset) / size) * 100)))
    byteOffset += size
    return {
      id: item.id,
      progress: itemProgress,
      status: itemProgress >= 99 ? 'processing' : itemProgress > 0 ? 'uploading' : 'idle',
      error: null,
    }
  })
}

function responseFromXhr(xhr: XMLHttpRequest): Response {
  const contentType = xhr.getResponseHeader('content-type') || 'application/json'
  return new Response(xhr.responseText || null, {
    status: xhr.status,
    statusText: xhr.statusText,
    headers: { 'Content-Type': contentType },
  })
}

export function submitProjectCreationWithProgress(input: {
  form: FormData
  references: ProjectStyleReferenceDraftFile[]
  onProgress: (update: ProjectStyleReferenceProgressUpdate) => void
}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/projects')
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept-Language', getPageLocale())
    xhr.upload.onprogress = (event) => {
      for (const update of calculateStyleReferenceUploadProgress(event.loaded, event.total, input.references)) {
        input.onProgress(update)
      }
    }
    xhr.onload = () => {
      const response = responseFromXhr(xhr)
      if (response.ok) {
        for (const reference of input.references) {
          input.onProgress({ id: reference.id, progress: 100, status: 'uploaded', error: null })
        }
      }
      resolve(response)
    }
    xhr.onerror = () => {
      for (const reference of input.references) {
        input.onProgress({
          id: reference.id,
          progress: 0,
          status: 'failed',
          error: '网络中断，未能上传这个参考文件。',
        })
      }
      reject(new Error('网络中断，作品创建请求未完成，请重试。'))
    }
    xhr.onabort = () => reject(new Error('作品创建请求已取消。'))
    xhr.send(input.form)
  })
}

export function readStyleReferenceFailureIndex(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const source = payload as Record<string, unknown>
  const error = source.error && typeof source.error === 'object'
    ? source.error as Record<string, unknown>
    : null
  const details = error?.details && typeof error.details === 'object'
    ? error.details as Record<string, unknown>
    : null
  const candidate = details?.styleReferenceIndex ?? source.styleReferenceIndex
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0
    ? candidate
    : null
}
