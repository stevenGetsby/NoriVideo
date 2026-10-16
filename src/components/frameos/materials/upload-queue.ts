export type MaterialUploadEntry = {
  id: string
  file: File
  title: string
  status: 'pending' | 'uploading' | 'success' | 'failed'
  error: string | null
}

export function createMaterialUploadEntryId() {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Only one file is in flight; retries never repeat already successful items. */
export async function runMaterialUploadQueue<T>(
  entries: readonly MaterialUploadEntry[],
  upload: (entry: MaterialUploadEntry) => Promise<T>,
  update: (id: string, status: MaterialUploadEntry['status'], error: string | null) => void,
  created: (material: T) => void,
) {
  for (const entry of entries) {
    if (entry.status !== 'pending' && entry.status !== 'failed') continue
    update(entry.id, 'uploading', null)
    let material: T
    try {
      material = await upload(entry)
    } catch (cause) {
      update(entry.id, 'failed', cause instanceof Error ? cause.message : '上传失败')
      continue
    }
    update(entry.id, 'success', null)
    created(material)
  }
}
