import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-fetch', () => ({ apiFetch: api }))
import { renameFrameosMaterial, trashFrameosMaterials } from '@/components/frameos/materials/material-actions'

describe('material client writes', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each(['', '   ', '名'.repeat(161)])('rejects an invalid name without a network request', async (title) => {
    await expect(renameFrameosMaterial('a', title)).rejects.toThrow()
    expect(api).not.toHaveBeenCalled()
  })
  it('normalizes whitespace and uses the authoritative returned name', async () => {
    api.mockResolvedValueOnce(Response.json({ material: { id: 'a/b', title: '服务端名称' } }))
    await expect(renameFrameosMaterial('a/b', ' 新的\n名称 ')).resolves.toMatchObject({ title: '服务端名称' })
    expect(api).toHaveBeenCalledWith('/api/frameos/materials/a%2Fb', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ title: '新的 名称' }),
    }))
  })
  it('does not pretend a rename succeeded when the response is incomplete', async () => {
    api.mockResolvedValueOnce(Response.json({ success: true }))
    await expect(renameFrameosMaterial('a', '名称')).rejects.toThrow('服务未返回')
  })
  it('does not pretend a batch was deleted after a server conflict', async () => {
    api.mockResolvedValueOnce(Response.json({ message: '有引用，不允许删除' }, { status: 409 }))
    await expect(trashFrameosMaterials(['a'])).rejects.toThrow('有引用')
  })
  it('deduplicates a batch but never truncates an oversized selection silently', async () => {
    api.mockResolvedValueOnce(Response.json({
      success: true,
      materialIds: ['a'],
      results: [
        { materialId: 'a', deleted: true, reason: null },
        { materialId: 'b', deleted: false, reason: '素材仍被画布引用。' },
      ],
    }))
    await expect(trashFrameosMaterials(['a', 'b', 'a'])).resolves.toMatchObject({
      deletedIds: ['a'],
      skipped: [{ materialId: 'b', deleted: false, reason: '素材仍被画布引用。' }],
    })
    expect(api).toHaveBeenCalledWith('/api/frameos/materials/bulk-delete', expect.objectContaining({
      body: JSON.stringify({ materialIds: ['a', 'b'] }),
    }))
    api.mockClear()
    await expect(trashFrameosMaterials(Array.from({ length: 201 }, (_, i) => String(i)))).rejects.toThrow('200')
    expect(api).not.toHaveBeenCalled()
  })
  it('does not remove client items when the server omits their deletion result', async () => {
    api.mockResolvedValueOnce(Response.json({ success: true, materialIds: ['a'], results: [{ materialId: 'a', deleted: true }] }))
    await expect(trashFrameosMaterials(['a', 'b'])).rejects.toThrow('完整的逐项删除结果')
  })
  it('submits a personal-to-project move with the normalized title', async () => {
    const { updateFrameosMaterial } = await import('@/components/frameos/materials/material-actions')
    api.mockResolvedValueOnce(Response.json({ material: { id: 'a', title: '共享角色', projectId: 'project-1' } }))
    await expect(updateFrameosMaterial('a', { title: ' 共享\n角色 ', projectId: 'project-1' })).resolves.toMatchObject({ projectId: 'project-1' })
  })
})