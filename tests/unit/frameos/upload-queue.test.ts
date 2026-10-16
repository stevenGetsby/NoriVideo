import { describe, expect, it, vi } from 'vitest'
import { createMaterialUploadEntryId, runMaterialUploadQueue, type MaterialUploadEntry } from '@/components/frameos/materials/upload-queue'
import { isImageUpload, materialTitleFromFilename } from '@/lib/frameos/upload-file-policy'

function entry(id: string, status: MaterialUploadEntry['status'] = 'pending'): MaterialUploadEntry {
  return { id, file: new File(['image'], `${id}.png`, { type: 'image/png' }), title: id, status, error: null }
}

describe('asset batch upload queue', () => {
  it('continues after one failure, serializes uploads and retries only unsuccessful items', async () => {
    let entries = [entry('a'), entry('b'), entry('c')]
    let active = 0
    let maximum = 0
    const upload = vi.fn(async (item: MaterialUploadEntry) => {
      active++
      maximum = Math.max(maximum, active)
      await Promise.resolve()
      active--
      if (item.id === 'b' && upload.mock.calls.length === 2) throw new Error('上游暂时不可用')
      return item.id
    })
    const created = vi.fn()
    const update = (id: string, status: MaterialUploadEntry['status'], error: string | null) => {
      entries = entries.map((item) => item.id === id ? { ...item, status, error } : item)
    }
    await runMaterialUploadQueue(entries, upload, update, created)
    expect(maximum).toBe(1)
    expect(entries.map((item) => item.status)).toEqual(['success', 'failed', 'success'])
    expect(entries[1].error).toBe('上游暂时不可用')
    await runMaterialUploadQueue(entries, upload, update, created)
    expect(upload.mock.calls.map(([item]) => item.id)).toEqual(['a', 'b', 'c', 'b'])
    expect(created.mock.calls.map(([id]) => id)).toEqual(['a', 'c', 'b'])
    expect(entries.every((item) => item.status === 'success')).toBe(true)
  })

  it('never re-uploads successful entries or entries already in flight', async () => {
    const upload = vi.fn()
    await runMaterialUploadQueue([entry('done', 'success'), entry('busy', 'uploading')], upload, vi.fn(), vi.fn())
    expect(upload).not.toHaveBeenCalled()
  })

  it('handles a hundred files with independent results', async () => {
    const upload = vi.fn(async (item: MaterialUploadEntry) => item.id)
    const created = vi.fn()
    await runMaterialUploadQueue(Array.from({ length: 100 }, (_, i) => entry(`asset-${i}`)), upload, vi.fn(), created)
    expect(created).toHaveBeenCalledTimes(100)
    expect(new Set(created.mock.calls.map(([id]) => id)).size).toBe(100)
  })

  it('can select files on an HTTP IP address without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {})
    try {
      const ids = Array.from({ length: 100 }, createMaterialUploadEntryId)
      expect(ids.every((id) => id.startsWith('upload-'))).toBe(true)
      expect(new Set(ids).size).toBe(100)
    } finally { vi.unstubAllGlobals() }
  })
  it('names assets from files and recognizes generic-MIME scene images without accepting other files', () => {
    expect(materialTitleFromFilename('  废弃 工厂.夜景.PNG')).toBe('废弃 工厂.夜景')
    expect(materialTitleFromFilename(`${'角色'.repeat(100)}.png`)).toHaveLength(160)
    expect(isImageUpload({ name: '场景.png', type: 'application/octet-stream' })).toBe(true)
    expect(isImageUpload({ name: '角色.webp', type: '' })).toBe(true)
    expect(isImageUpload({ name: 'scene.exe', type: 'application/octet-stream' })).toBe(false)
    expect(isImageUpload({ name: 'scene.png', type: 'text/plain' })).toBe(false)
  })
})
