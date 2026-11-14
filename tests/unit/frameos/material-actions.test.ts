import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-fetch', () => ({ apiFetch: api }))
import {
  describeMaterialImageReplacement,
  renameFrameosMaterial,
  replaceFrameosMaterialImage,
  trashFrameosMaterials,
} from '@/components/frameos/materials/material-actions'

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

  describe('replacing a library picture', () => {
    const png = () => new File([new Uint8Array([1, 2, 3])], '新形象.png', { type: 'image/png' })
    const created = { id: 'replacement', title: '关羽', projectId: 'project-1' }

    it('posts the file to the dedicated route and reports what happened to the original and the voice', async () => {
      api.mockResolvedValueOnce(Response.json({
        success: true, material: created, previousMaterialId: 'a/b', retired: 'superseded',
        referenceCounts: { currentCanvases: 2, workflowTemplates: 1, historySnapshots: 5 }, voiceKept: true, voiceDropped: false,
      }))
      await expect(replaceFrameosMaterialImage('a/b', png())).resolves.toMatchObject({
        material: created, previousMaterialId: 'a/b', retired: 'superseded', referenceCount: 3, voiceKept: true, voiceDropped: false,
      })
      const [url, init] = api.mock.calls[0]
      expect(url).toBe('/api/frameos/materials/a%2Fb/replace-image')
      expect(init.method).toBe('POST')
      expect(init.body).toBeInstanceOf(FormData)
      expect((init.body as FormData).get('file')).toBeInstanceOf(File)
      expect(init.headers).toBeUndefined()
    })

    it.each([
      ['a non-image file', new File(['x'], '说明.txt', { type: 'text/plain' })],
      ['an empty file', new File([], '空.png', { type: 'image/png' })],
    ])('rejects %s before any request', async (_label, file) => {
      await expect(replaceFrameosMaterialImage('a', file)).rejects.toThrow()
      expect(api).not.toHaveBeenCalled()
    })

    it('surfaces the server message instead of pretending the picture changed', async () => {
      api.mockResolvedValueOnce(Response.json({ message: '素材已发生变化，请刷新后重试。' }, { status: 409 }))
      await expect(replaceFrameosMaterialImage('a', png())).rejects.toThrow('素材已发生变化')
    })

    it.each([
      ['an incomplete body', { success: true }],
      ['the same id echoed back', { success: true, material: { id: 'a' }, previousMaterialId: 'a', retired: 'trashed' }],
      ['an unknown retirement mode', { success: true, material: created, previousMaterialId: 'a', retired: 'deleted' }],
      ['another original', { success: true, material: created, previousMaterialId: 'other', retired: 'trashed' }],
    ])('refuses %s', async (_label, body) => {
      api.mockResolvedValueOnce(Response.json(body))
      await expect(replaceFrameosMaterialImage('a', png())).rejects.toThrow('服务未返回替换后的素材')
    })

    it('words the outcome for the three situations a user can end up in', () => {
      expect(describeMaterialImageReplacement('关羽', { retired: 'trashed', referenceCount: 0, voiceKept: true, voiceDropped: false }))
        .toBe('已替换「关羽」的图片。角色音色已保持绑定，无需重新上传音频。原图片已移入回收站，可随时恢复。')
      const referenced = describeMaterialImageReplacement('关羽', { retired: 'superseded', referenceCount: 2, voiceKept: true, voiceDropped: false })
      expect(referenced).toContain('仍有 2 个画布或工作流模板在使用原图片')
      expect(referenced).toContain('继续按原图片生成')
      expect(referenced).not.toContain('回收站')
      expect(describeMaterialImageReplacement('场景', { retired: 'trashed', referenceCount: 0, voiceKept: false, voiceDropped: false }))
        .toBe('已替换「场景」的图片。原图片已移入回收站，可随时恢复。')
      expect(describeMaterialImageReplacement('关羽', { retired: 'trashed', referenceCount: 0, voiceKept: false, voiceDropped: true }))
        .toContain('原绑定的音色已不可用，请重新设置角色音色')
      expect(describeMaterialImageReplacement('关羽', { retired: 'superseded', referenceCount: 0, voiceKept: false, voiceDropped: false }))
        .toContain('仍有 1 个画布或工作流模板')
    })
  })
})
