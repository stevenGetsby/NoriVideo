import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  select: vi.fn(), provider: vi.fn(), project: vi.fn(),
}))
vi.mock('@/lib/api-config', () => ({
  resolveModelSelection: mocks.select, getProviderConfig: mocks.provider,
  getProviderKey: (value: string) => value.split(':')[0],
}))
vi.mock('@/lib/config-service', () => ({ getProjectModelConfig: mocks.project }))
import { getSeedanceAssetsProvider } from '@/lib/volcengine/seedance-assets-provider'
import { KuaiziAssetsClient } from '@/lib/providers/kuaizi/assets'

describe('Seedance asset provider and ownership selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.select.mockResolvedValue({ provider: 'kuaizi', modelId: 'doubao-seedance-2-5-260628' })
    mocks.project.mockResolvedValue({ videoModel: 'nori::norivideo2.5' })
    mocks.provider.mockResolvedValue({ apiKey: 'test-account-a', baseUrl: 'https://test' })
  })

  it('uses the routed model, not TOS credentials, for Kuaizi asset authentication', async () => {
    const result = await getSeedanceAssetsProvider({ userId: 'u1', projectId: 'p1' })
    expect(result.client).toBeInstanceOf(KuaiziAssetsClient)
    expect(result.projectName).toBe('')
    expect(result.scope).toMatch(/^kuaizi:[a-f0-9]{64}$/)
    expect(mocks.select).toHaveBeenCalledWith('u1', 'nori::norivideo2.5', 'video')
  })

  it('isolates changed accounts and endpoints without exposing credentials in stored scope', async () => {
    const a = await getSeedanceAssetsProvider({ userId: 'u1', projectId: 'p1', modelKey: 'nori::norivideo2.5' })
    mocks.provider.mockResolvedValue({ apiKey: 'test-account-b', baseUrl: 'https://test' })
    const b = await getSeedanceAssetsProvider({ userId: 'u1', projectId: 'p1' })
    expect(a.scope).not.toBe(b.scope)
    expect(b.scope).not.toContain('test-account-b')
    expect(mocks.project).toHaveBeenCalledTimes(1)
  })

  it('rejects retired Ark asset clients before reading credentials', async () => {
    mocks.select.mockResolvedValue({ provider: 'ark', modelId: 'doubao-seedance-test' })

    await expect(getSeedanceAssetsProvider({ userId: 'u1', projectId: 'p1' }))
      .rejects.toThrow('SEEDANCE_ASSETS_PROVIDER_UNSUPPORTED')
    expect(mocks.provider).not.toHaveBeenCalled()
  })
})
