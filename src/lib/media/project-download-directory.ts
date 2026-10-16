'use client'

export type DownloadDirectoryHandle = {
  name: string
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<string>
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<string>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (blob: Blob) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> }>
  }>
}

const DATABASE = 'nori-project-downloads-v1'
const STORE = 'directories'
export function projectDownloadDirectoryKey(accountId: string, projectId: string) {
  if (!accountId.trim() || !projectId.trim()) throw new Error('下载目录缺少账号或作品标识')
  return JSON.stringify([accountId, projectId])
}

async function directoryRecord(key: string, next?: DownloadDirectoryHandle | null): Promise<DownloadDirectoryHandle | null> {
  if (typeof indexedDB === 'undefined') return null
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1)
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE) }
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, next === undefined ? 'readonly' : 'readwrite')
      const store = tx.objectStore(STORE)
      const operation = next === undefined ? store.get(key) : next === null ? store.delete(key) : store.put(next, key)
      let value: DownloadDirectoryHandle | null = null
      operation.onsuccess = () => { value = next === undefined ? operation.result || null : next }
      tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}

export async function chooseProjectDownloadDirectory(accountId: string, projectId: string) {
  const picker = (window as Window & { showDirectoryPicker?: (options: { mode: 'readwrite'; startIn: 'downloads' }) => Promise<DownloadDirectoryHandle> }).showDirectoryPicker
  if (!window.isSecureContext || !picker) throw new Error('固定本地目录需要 HTTPS 或 localhost 下的 Chrome/Edge；当前环境可继续普通下载。')
  const directory = await picker({ mode: 'readwrite', startIn: 'downloads' })
  await directoryRecord(projectDownloadDirectoryKey(accountId, projectId), directory)
  return directory
}

export async function getProjectDownloadDirectory(accountId: string, projectId: string, requestPermission = false) {
  const key = projectDownloadDirectoryKey(accountId, projectId)
  const handle = await directoryRecord(key).catch(() => null)
  if (!handle) return null
  let permission = await handle.queryPermission?.({ mode: 'readwrite' })
  if (permission !== 'granted' && requestPermission) permission = await handle.requestPermission?.({ mode: 'readwrite' })
  return permission === 'granted' ? handle : null
}

export async function clearProjectDownloadDirectory(accountId: string, projectId: string) {
  await directoryRecord(projectDownloadDirectoryKey(accountId, projectId), null)
}

async function writeDownload(directory: DownloadDirectoryHandle, fileName: string, blob: Blob) {
  if (!fileName || /[\\/\u0000]/.test(fileName) || fileName === '.' || fileName === '..') throw new Error('下载文件名无效')
  let name = fileName
  // Never overwrite a teammate's previously downloaded output or a newer edit.
  for (let suffix = 0; suffix < 1000; suffix++) {
    name = suffix ? fileName.replace(/(\.[^.]+)?$/, ` (${suffix + 1})$1`) : fileName
    try { await directory.getFileHandle(name) }
    catch (cause) {
      if (!(cause instanceof DOMException) || cause.name !== 'NotFoundError') throw cause
      const file = await directory.getFileHandle(name, { create: true })
      const writable = await file.createWritable()
      try { await writable.write(blob); await writable.close() }
      catch (error) { await writable.abort?.().catch(() => undefined); throw error }
      return name
    }
  }
  throw new Error('同名文件过多，请选择其它下载目录')
}

const downloadQueues = new Map<string, Promise<unknown>>()
export async function writeProjectDownload(directory: DownloadDirectoryHandle, fileName: string, blob: Blob) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks) return locks.request(`nori-download:${directory.name}:${fileName}`, () => writeDownload(directory, fileName, blob))
  const key = `${directory.name}:${fileName}`
  const previous = downloadQueues.get(key) || Promise.resolve()
  const next = previous.catch(() => undefined).then(() => writeDownload(directory, fileName, blob))
  downloadQueues.set(key, next)
  try { return await next } finally { if (downloadQueues.get(key) === next) downloadQueues.delete(key) }
}

export async function saveProjectDownload(accountId: string, projectId: string, fileName: string, blob: Blob, directory?: DownloadDirectoryHandle | null) {
  const target = directory || await getProjectDownloadDirectory(accountId, projectId)
  if (target) {
    try { return { method: 'directory' as const, name: await writeProjectDownload(target, fileName, blob) } }
    catch (cause) {
      if (cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')) await clearProjectDownloadDirectory(accountId, projectId)
      throw cause
    }
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = fileName; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { method: 'browser' as const, name: fileName }
}
