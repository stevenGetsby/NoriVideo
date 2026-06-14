import fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: {
      user: { id: 'user-1' },
    },
  })),
  isErrorResponse: (value: unknown) => value instanceof NextResponse,
}))

const storageMock = vi.hoisted(() => ({
  resetStorageProvider: vi.fn(),
  uploadObject: vi.fn(),
  getSignedObjectUrl: vi.fn(),
  getObjectBuffer: vi.fn(),
  deleteObject: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/storage', () => storageMock)

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/user/storage-config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function buildGetRequest() {
  return new NextRequest('http://localhost/api/user/storage-config', {
    method: 'GET',
  })
}

function buildPostRequest() {
  return new NextRequest('http://localhost/api/user/storage-config', {
    method: 'POST',
  })
}

describe('/api/user/storage-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('hides global storage config reads unless internal tools are enabled', async () => {
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'false')
    const readSpy = vi.spyOn(fs, 'readFile')
    const { GET } = await import('@/app/api/user/storage-config/route')

    const response = await GET(
      buildGetRequest() as never,
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(404)
    expect(authMock.requireUserAuth).not.toHaveBeenCalled()
    expect(readSpy).not.toHaveBeenCalled()

    readSpy.mockRestore()
  })

  it('allows global storage config reads for internal tools', async () => {
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'true')
    const readSpy = vi.spyOn(fs, 'readFile').mockResolvedValue([
      'STORAGE_TYPE=tos',
      'TOS_ENDPOINT=https://tos.example.com',
      'TOS_PUBLIC_ENDPOINT=https://public.example.com',
      'TOS_BUCKET=bucket-1',
      'TOS_REGION=cn-test',
      'TOS_ACCESS_KEY=ak',
      'TOS_SECRET_KEY=sk',
    ].join('\n'))
    const { GET } = await import('@/app/api/user/storage-config/route')

    const response = await GET(
      buildGetRequest() as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json() as { config?: Record<string, unknown> }

    expect(response.status).toBe(200)
    expect(authMock.requireUserAuth).toHaveBeenCalledTimes(1)
    expect(payload.config).toEqual({
      storageType: 'tos',
      endpoint: 'https://tos.example.com',
      publicEndpoint: 'https://public.example.com',
      bucket: 'bucket-1',
      region: 'cn-test',
      hasAccessKey: true,
      hasSecretKey: true,
    })
    expect(JSON.stringify(payload)).not.toContain('ak')
    expect(JSON.stringify(payload)).not.toContain('sk')

    readSpy.mockRestore()
  })

  it('hides global storage config writes unless internal tools are enabled', async () => {
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'false')
    const writeSpy = vi.spyOn(fs, 'writeFile')
    const { PUT } = await import('@/app/api/user/storage-config/route')

    const response = await PUT(
      buildRequest({
        endpoint: 'https://tos.example.com',
        publicEndpoint: 'https://public.example.com',
        bucket: 'bucket-1',
        region: 'cn-test',
        accessKey: 'ak',
        secretKey: 'sk',
      }) as never,
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(404)
    expect(authMock.requireUserAuth).not.toHaveBeenCalled()
    expect(writeSpy).not.toHaveBeenCalled()
    expect(storageMock.resetStorageProvider).not.toHaveBeenCalled()

    writeSpy.mockRestore()
  })

  it('allows global storage config writes for internal tools', async () => {
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'true')
    const readSpy = vi.spyOn(fs, 'readFile').mockResolvedValue('STORAGE_TYPE=local\n')
    const writeSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined)
    const { PUT } = await import('@/app/api/user/storage-config/route')

    const response = await PUT(
      buildRequest({
        endpoint: 'https://tos.example.com',
        publicEndpoint: 'https://public.example.com',
        bucket: 'bucket-1',
        region: 'cn-test',
        accessKey: 'ak',
        secretKey: 'sk',
      }) as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(authMock.requireUserAuth).toHaveBeenCalledTimes(1)
    expect(readSpy).toHaveBeenCalled()
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('.env.local'),
      expect.stringContaining('TOS_BUCKET=bucket-1'),
      'utf8',
    )
    expect(storageMock.resetStorageProvider).toHaveBeenCalledTimes(1)

    readSpy.mockRestore()
    writeSpy.mockRestore()
  })

  it('hides global storage probes unless internal tools are enabled', async () => {
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'false')
    const { POST } = await import('@/app/api/user/storage-config/route')

    const response = await POST(
      buildPostRequest() as never,
      { params: Promise.resolve({}) },
    )

    expect(response.status).toBe(404)
    expect(authMock.requireUserAuth).not.toHaveBeenCalled()
    expect(storageMock.resetStorageProvider).not.toHaveBeenCalled()
    expect(storageMock.uploadObject).not.toHaveBeenCalled()
    expect(storageMock.getSignedObjectUrl).not.toHaveBeenCalled()
    expect(storageMock.getObjectBuffer).not.toHaveBeenCalled()
    expect(storageMock.deleteObject).not.toHaveBeenCalled()
  })

  it('allows global storage probes for internal tools', async () => {
    vi.stubEnv('NORI_INTERNAL_AGENT_TOOLS', 'true')
    const probeContent = 'tos probe 2026-06-13T10:00:00.000Z'
    storageMock.uploadObject.mockResolvedValue(undefined)
    storageMock.getSignedObjectUrl.mockResolvedValue('https://storage.example.com/probe.txt')
    storageMock.getObjectBuffer.mockImplementation(async () => Buffer.from(probeContent))
    storageMock.deleteObject.mockResolvedValue(undefined)
    const fetchMock = vi.fn(async () => new Response(probeContent, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T10:00:00.000Z'))
    const { POST } = await import('@/app/api/user/storage-config/route')

    const response = await POST(
      buildPostRequest() as never,
      { params: Promise.resolve({}) },
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ success: true, httpStatus: 200 })
    expect(authMock.requireUserAuth).toHaveBeenCalledTimes(1)
    expect(storageMock.resetStorageProvider).toHaveBeenCalledTimes(1)
    expect(storageMock.uploadObject).toHaveBeenCalledWith(
      Buffer.from(probeContent),
      expect.stringMatching(/^settings-probe\/.+\.txt$/),
      1,
      'text/plain',
    )
    expect(storageMock.getSignedObjectUrl).toHaveBeenCalledWith(expect.stringMatching(/^settings-probe\/.+\.txt$/), 300)
    expect(fetchMock).toHaveBeenCalledWith('https://storage.example.com/probe.txt')
    expect(storageMock.deleteObject).toHaveBeenCalledWith(expect.stringMatching(/^settings-probe\/.+\.txt$/))

    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})
