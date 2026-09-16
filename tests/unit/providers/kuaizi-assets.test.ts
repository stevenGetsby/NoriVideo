import { afterEach, describe, expect, it, vi } from 'vitest'
import { KuaiziAssetsClient } from '@/lib/providers/kuaizi/assets'

describe('Kuaizi private assets compatibility API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses ApiKey, the action endpoint, PascalCase and string IDs without ProjectName', async () => {
    const id = '1800657071180349888'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ Result: { Id: id, Status: 'Processing' } })))
    vi.stubGlobal('fetch', fetchMock)
    const client = new KuaiziAssetsClient({ apiKey: 'test-only', baseUrl: 'https://test/ai-open-platform-api' })
    expect(await client.createImageAsset({ groupId: id, name: 'face', url: 'https://test/face.png', projectName: 'must-not-send' }))
      .toEqual({ Id: id, Status: 'Processing' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://test/ai-open-platform-api/api/support/v1/asset?Action=CreateAsset&Version=2024-01-01')
    expect(init.headers).toEqual({ ApiKey: 'test-only', 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ GroupId: id, Name: 'face', URL: 'https://test/face.png', AssetType: 'Image' })
  })

  it('reads Items and Active while preserving long decimal IDs', async () => {
    const client = new KuaiziAssetsClient({ apiKey: 'test-only' })
    const id = '1800657071180349888'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ Result: { Items: [{ Id: id }], TotalCount: 1 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ Result: { Id: id, Status: 'Active' } })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await client.listAssetGroups({ projectName: '' })).toMatchObject({ Items: [{ Id: id }] })
    expect(await client.getAsset({ assetId: id, projectName: '' })).toEqual({ Id: id, Status: 'Active' })
  })

  it('rejects API error envelopes and unsafe numeric IDs', async () => {
    const client = new KuaiziAssetsClient({ apiKey: 'test-only' })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ResponseMetadata: { Error: { Code: 'Unauthorized' } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ Result: { Id: 1800657071180349888 } }))))
    await expect(client.getAsset({ assetId: '123', projectName: '' })).rejects.toThrow('Unauthorized')
    await expect(client.createAssetGroup({ name: 'group', projectName: '' })).rejects.toThrow('KUAIZI_ASSET_ID_INVALID')
  })
})
