import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
}))

const cryptoMock = vi.hoisted(() => ({
  decryptApiKey: vi.fn((value: string) => `decrypted:${value}`),
}))

const serviceConfigMock = vi.hoisted(() => ({
  getServiceSeedanceAssetsConfig: vi.fn(),
  getServiceStorageConfig: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/crypto-utils', () => cryptoMock)
vi.mock('@/lib/service-config', () => serviceConfigMock)

import { getSeedanceAssetsConfig } from '@/lib/volcengine/seedance-assets-config'

describe('getSeedanceAssetsConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.userPreference.findUnique.mockResolvedValue(null)
    serviceConfigMock.getServiceSeedanceAssetsConfig.mockReturnValue(undefined)
    serviceConfigMock.getServiceStorageConfig.mockReturnValue(undefined)
    vi.stubEnv('TOS_ACCESS_KEY', '')
    vi.stubEnv('TOS_SECRET_KEY', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers the user-specific encrypted private-asset credentials', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      arkAssetsAccessKeyId: 'encrypted-ak',
      arkAssetsSecretAccessKey: 'encrypted-sk',
      arkAssetsProjectName: 'team-assets',
    })
    serviceConfigMock.getServiceStorageConfig.mockReturnValue({
      type: 'tos',
      tos: { accessKey: 'platform-ak', secretKey: 'platform-sk' },
    })

    await expect(getSeedanceAssetsConfig('user-1')).resolves.toEqual({
      accessKeyId: 'decrypted:encrypted-ak',
      secretAccessKey: 'decrypted:encrypted-sk',
      projectName: 'team-assets',
    })
  })

  it('uses centrally managed TOS credentials when the account has no override', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      arkAssetsAccessKeyId: null,
      arkAssetsSecretAccessKey: null,
      arkAssetsProjectName: null,
    })
    serviceConfigMock.getServiceStorageConfig.mockReturnValue({
      type: 'tos',
      tos: { accessKey: 'platform-ak', secretKey: 'platform-sk' },
    })

    await expect(getSeedanceAssetsConfig('user-2')).resolves.toEqual({
      accessKeyId: 'platform-ak',
      secretAccessKey: 'platform-sk',
      projectName: 'default',
    })
    expect(cryptoMock.decryptApiKey).not.toHaveBeenCalled()
  })

  it('prefers centrally managed Seedance private-asset credentials over storage credentials', async () => {
    serviceConfigMock.getServiceSeedanceAssetsConfig.mockReturnValue({
      accessKeyId: 'assets-ak',
      secretAccessKey: 'assets-sk',
      projectName: 'private-assets',
    })
    serviceConfigMock.getServiceStorageConfig.mockReturnValue({
      type: 'tos',
      tos: { accessKey: 'storage-ak', secretKey: 'storage-sk' },
    })

    await expect(getSeedanceAssetsConfig('user-assets')).resolves.toEqual({
      accessKeyId: 'assets-ak',
      secretAccessKey: 'assets-sk',
      projectName: 'private-assets',
    })
  })

  it('falls back to the TOS environment credentials when the service file has placeholders', async () => {
    serviceConfigMock.getServiceStorageConfig.mockReturnValue({
      type: 'tos',
      tos: { accessKey: 'your-access-key', secretKey: 'replace-me' },
    })
    vi.stubEnv('TOS_ACCESS_KEY', 'environment-ak')
    vi.stubEnv('TOS_SECRET_KEY', 'environment-sk')

    await expect(getSeedanceAssetsConfig('user-3')).resolves.toEqual({
      accessKeyId: 'environment-ak',
      secretAccessKey: 'environment-sk',
      projectName: 'default',
    })
  })

  it('requires a complete CreateAsset credential pair', async () => {
    serviceConfigMock.getServiceStorageConfig.mockReturnValue({
      type: 'tos',
      tos: { accessKey: 'platform-ak', secretKey: '' },
    })

    await expect(getSeedanceAssetsConfig('user-4')).rejects.toThrow(
      '请在管理平台配置具备 CreateAsset 权限的 TOS AK/SK',
    )
  })
})
