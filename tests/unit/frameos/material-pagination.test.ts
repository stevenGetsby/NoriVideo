import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAllFrameosMaterials } from '@/components/frameos/materials/fetch-all-materials'
import { fetchAllProjectOptions } from '@/components/frameos/works/fetch-all-projects'

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-fetch', () => ({ apiFetch: fetchMock }))

describe('large asset directory pagination', () => {
  beforeEach(() => vi.clearAllMocks())
  it('loads older scene assets after a full first page of characters, without repeating sync', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      materials: Array.from({ length: 500 }, (_, i) => ({ id: `character-${i}`, metadata: { assetCategory: 'character' } })),
      pagination: { nextCursor: 'character-499' },
    }))).mockResolvedValueOnce(new Response(JSON.stringify({
      materials: [{ id: 'scene-1', metadata: { assetCategory: 'location' } }], pagination: { nextCursor: null },
    })))
    const controller = new AbortController()
    const result = await fetchAllFrameosMaterials(new URLSearchParams({ projectId: 'p1', limit: '500', sync: '1' }), controller.signal)
    expect(result).toHaveLength(501)
    expect(result.at(-1)?.id).toBe('scene-1')
    const second = new URL(fetchMock.mock.calls[1][0], 'http://localhost')
    expect(second.searchParams.get('cursor')).toBe('character-499')
    expect(second.searchParams.has('sync')).toBe(false)
    expect(fetchMock.mock.calls[1][1].signal).toBe(controller.signal)
  })
  it('fails clearly when a server repeats a cursor instead of looping indefinitely', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ materials: [], pagination: { nextCursor: 'same' } })))
    await expect(fetchAllFrameosMaterials(new URLSearchParams())).rejects.toThrow('重复游标')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('reads all advertised project pages without duplicate directories', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ projects: [{ id: 'a', name: 'A' }], pagination: { totalPages: 2 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ projects: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], pagination: { totalPages: 2 } })))
    expect(await fetchAllProjectOptions()).toEqual([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
    expect(fetchMock.mock.calls[1][0]).toBe('/api/projects?page=2&pageSize=100')
  })

  it('loads the 101st work and forwards the abort signal on every page', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      projects: Array.from({ length: 100 }, (_, i) => ({ id: `p-${i}`, name: `作品 ${i}` })),
      pagination: { totalPages: 2 },
    }))).mockResolvedValueOnce(new Response(JSON.stringify({
      works: [{ id: 'p-100', name: '作品 101' }], pagination: { totalPages: 2 },
    })))
    const controller = new AbortController()
    const rows = await fetchAllProjectOptions(controller.signal)
    expect(rows).toHaveLength(101)
    expect(rows.at(-1)?.id).toBe('p-100')
    expect(fetchMock.mock.calls.every(([, options]) => options.signal === controller.signal)).toBe(true)
  })

  it('does not present a partial list as complete if a later page fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      projects: [{ id: 'a', name: 'A' }], pagination: { totalPages: 2 },
    }))).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: '第二页暂不可用' } }), { status: 503 }))
    await expect(fetchAllProjectOptions()).rejects.toThrow('第二页暂不可用')
  })

  it('does not resurrect legacy entries when canonical works is an empty array', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      works: [], projects: [{ id: 'old', name: 'Old' }], pagination: { totalPages: 0 },
    })))
    expect(await fetchAllProjectOptions()).toEqual([])
  })

  it.each([-1, 1.5, 'invalid'])('rejects malformed pagination instead of looping: %j', async (pages) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ pagination: { totalPages: pages } })))
    await expect(fetchAllProjectOptions()).rejects.toThrow('分页信息无效')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not start another page request after cancellation', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(async () => {
      controller.abort()
      return new Response(JSON.stringify({ projects: [], pagination: { totalPages: 2 } }))
    })
    await expect(fetchAllProjectOptions(controller.signal)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
