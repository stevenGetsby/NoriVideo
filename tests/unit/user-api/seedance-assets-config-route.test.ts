import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}))

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const cryptoMock = vi.hoisted(() => ({
  encryptApiKey: vi.fn((value: string) => `enc:${value}`),
  decryptApiKey: vi.fn((value: string) => value.replace(/^enc:/, '')),
}))

const seedanceConfigMock = vi.hoisted(() => ({
  getSeedanceAssetsConfig: vi.fn(),
}))

const seedanceClientState = vi.hoisted(() => ({
  listAssetGroups: vi.fn(),
  constructorArgs: [] as Array<unknown>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/api-auth', () => authMock)

vi.mock('@/lib/crypto-utils', () => cryptoMock)

vi.mock('@/lib/volcengine/seedance-assets-config', () => seedanceConfigMock)

vi.mock('@/lib/volcengine/seedance-assets-client', () => ({
  SeedanceAssetsClient: class SeedanceAssetsClient {
    constructor(config: unknown) {
      seedanceClientState.constructorArgs.push(config)
    }

    listAssetGroups(input: unknown) {
      return seedanceClientState.listAssetGroups(input)
    }
  },
}))

function buildPutRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/user/seedance-assets-config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/user/seedance-assets-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedanceClientState.constructorArgs = []
  })

  it('reads the current user seedance asset config without returning secrets', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      arkAssetsAccessKeyId: 'enc:ak-1',
      arkAssetsSecretAccessKey: 'enc:sk-1',
      arkAssetsProjectName: 'project-a',
    })
    const { GET } = await import('@/app/api/user/seedance-assets-config/route')

    const response = await GET(
      new NextRequest('http://localhost/api/user/seedance-assets-config') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(prismaMock.userPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: {
        arkAssetsAccessKeyId: true,
        arkAssetsSecretAccessKey: true,
        arkAssetsProjectName: true,
      },
    })
    expect(payload).toEqual({
      accessKeyId: '',
      secretAccessKey: '',
      projectName: 'project-a',
      configured: true,
      hasAccessKeyId: true,
      hasSecretAccessKey: true,
    })
    expect(JSON.stringify(payload)).not.toContain('ak-1')
    expect(JSON.stringify(payload)).not.toContain('sk-1')
    expect(cryptoMock.decryptApiKey).not.toHaveBeenCalled()
  })

  it('defaults missing config without writing global runtime state', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue(null)
    const { GET } = await import('@/app/api/user/seedance-assets-config/route')

    const response = await GET(
      new NextRequest('http://localhost/api/user/seedance-assets-config') as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      accessKeyId: '',
      secretAccessKey: '',
      projectName: 'default',
      configured: false,
      hasAccessKeyId: false,
      hasSecretAccessKey: false,
    })
    expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('persists encrypted seedance asset config on the current user preference', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue(null)
    prismaMock.userPreference.upsert.mockResolvedValue({ userId: 'user-1' })
    const { PUT } = await import('@/app/api/user/seedance-assets-config/route')

    const response = await PUT(
      buildPutRequest({
        accessKeyId: '  ak-2  ',
        secretAccessKey: '  sk-2  ',
        projectName: '  project-b  ',
      }) as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ success: true })
    expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: {
        arkAssetsAccessKeyId: 'enc:ak-2',
        arkAssetsSecretAccessKey: 'enc:sk-2',
        arkAssetsProjectName: 'project-b',
      },
      create: {
        userId: 'user-1',
        arkAssetsAccessKeyId: 'enc:ak-2',
        arkAssetsSecretAccessKey: 'enc:sk-2',
        arkAssetsProjectName: 'project-b',
      },
    })
  })

  it('preserves existing seedance asset credentials when key fields are omitted', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      arkAssetsAccessKeyId: 'enc:ak-existing',
      arkAssetsSecretAccessKey: 'enc:sk-existing',
    })
    prismaMock.userPreference.upsert.mockResolvedValue({ userId: 'user-1' })
    const { PUT } = await import('@/app/api/user/seedance-assets-config/route')

    const response = await PUT(
      buildPutRequest({ projectName: '  project-c  ' }) as never,
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(200)
    expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: {
        arkAssetsAccessKeyId: 'enc:ak-existing',
        arkAssetsSecretAccessKey: 'enc:sk-existing',
        arkAssetsProjectName: 'project-c',
      },
      create: {
        userId: 'user-1',
        arkAssetsAccessKeyId: 'enc:ak-existing',
        arkAssetsSecretAccessKey: 'enc:sk-existing',
        arkAssetsProjectName: 'project-c',
      },
    })
    expect(cryptoMock.encryptApiKey).not.toHaveBeenCalled()
  })

  it('clears both seedance asset credentials when both key fields are empty', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      arkAssetsAccessKeyId: 'enc:ak-existing',
      arkAssetsSecretAccessKey: 'enc:sk-existing',
    })
    prismaMock.userPreference.upsert.mockResolvedValue({ userId: 'user-1' })
    const { PUT } = await import('@/app/api/user/seedance-assets-config/route')

    const response = await PUT(
      buildPutRequest({ accessKeyId: '', secretAccessKey: '', projectName: 'project-d' }) as never,
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(200)
    expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: {
        arkAssetsAccessKeyId: null,
        arkAssetsSecretAccessKey: null,
        arkAssetsProjectName: 'project-d',
      },
      create: {
        userId: 'user-1',
        arkAssetsAccessKeyId: null,
        arkAssetsSecretAccessKey: null,
        arkAssetsProjectName: 'project-d',
      },
    })
  })

  it('rejects writes that would leave partial seedance asset credentials', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({
      arkAssetsAccessKeyId: 'enc:ak-existing',
      arkAssetsSecretAccessKey: 'enc:sk-existing',
    })
    const { PUT } = await import('@/app/api/user/seedance-assets-config/route')

    const response = await PUT(
      buildPutRequest({ accessKeyId: 'ak-2', secretAccessKey: '' }) as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error?.details).toMatchObject({
      code: 'SEEDANCE_ASSETS_CONFIG_REQUIRED',
      field: 'accessKeyId',
    })
    expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('tests saved seedance asset credentials without accepting or returning secrets', async () => {
    seedanceConfigMock.getSeedanceAssetsConfig.mockResolvedValue({
      accessKeyId: 'ak-secret',
      secretAccessKey: 'sk-secret',
      projectName: 'project-a',
    })
    seedanceClientState.listAssetGroups.mockResolvedValue({
      AssetGroups: [{ Id: 'group-1', Name: 'Characters' }],
      Total: 3,
    })
    const { POST } = await import('@/app/api/user/seedance-assets-config/test/route')

    const response = await POST(
      new NextRequest('http://localhost/api/user/seedance-assets-config/test', { method: 'POST' }) as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(seedanceConfigMock.getSeedanceAssetsConfig).toHaveBeenCalledWith('user-1')
    expect(seedanceClientState.constructorArgs).toEqual([{
      accessKeyId: 'ak-secret',
      secretAccessKey: 'sk-secret',
      projectName: 'project-a',
    }])
    expect(seedanceClientState.listAssetGroups).toHaveBeenCalledWith({
      projectName: 'project-a',
      pageSize: 1,
    })
    expect(payload).toMatchObject({
      success: true,
      configured: true,
      projectName: 'project-a',
      assetGroupCount: 1,
      totalAssetGroupCount: 3,
    })
    expect(typeof payload.latencyMs).toBe('number')
    expect(JSON.stringify(payload)).not.toContain('ak-secret')
    expect(JSON.stringify(payload)).not.toContain('sk-secret')
  })

  it('reports missing seedance asset credentials as a probe result', async () => {
    seedanceConfigMock.getSeedanceAssetsConfig.mockRejectedValue(
      new Error('SEEDANCE_ASSETS_CONFIG_REQUIRED: missing'),
    )
    const { POST } = await import('@/app/api/user/seedance-assets-config/test/route')

    const response = await POST(
      new NextRequest('http://localhost/api/user/seedance-assets-config/test', { method: 'POST' }) as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: false,
      configured: false,
      code: 'SEEDANCE_ASSETS_CONFIG_REQUIRED',
      message: 'Seedance asset credentials are not configured.',
    })
    expect(seedanceClientState.listAssetGroups).not.toHaveBeenCalled()
  })

  it('does not leak provider error details from seedance asset probe failures', async () => {
    seedanceConfigMock.getSeedanceAssetsConfig.mockResolvedValue({
      accessKeyId: 'ak-secret',
      secretAccessKey: 'sk-secret',
      projectName: 'project-a',
    })
    seedanceClientState.listAssetGroups.mockRejectedValue(
      new Error('Credential=ak-secret/scope Signature=sk-secret'),
    )
    const { POST } = await import('@/app/api/user/seedance-assets-config/test/route')

    const response = await POST(
      new NextRequest('http://localhost/api/user/seedance-assets-config/test', { method: 'POST' }) as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: false,
      configured: true,
      code: 'SEEDANCE_ASSETS_PROBE_FAILED',
      message: 'Seedance asset library probe failed.',
    })
    expect(JSON.stringify(payload)).not.toContain('ak-secret')
    expect(JSON.stringify(payload)).not.toContain('sk-secret')
    expect(JSON.stringify(payload)).not.toContain('Credential=')
  })
})
