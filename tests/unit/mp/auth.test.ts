import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  consumerUser: { findUnique: vi.fn(), update: vi.fn() },
}))
const redisMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn(), child: vi.fn() }),
}))

import { optionalConsumer, requireConsumerAuth, withConsumerTokenHeader } from '@/lib/mp/auth'
import { signConsumerToken, verifyConsumerToken } from '@/lib/mp/token'

// requireConsumerAuth/withConsumerTokenHeader 内部用真实时钟，测试时间必须与之对齐
const NOW = Math.floor(Date.now() / 1000)
const row = { id: 'u1', openid: 'openid-abc', nickname: '观众abc', avatarIndex: 0, status: 'active', tokenVersion: 2 }

function requestWith(token: string | null): NextRequest {
  const headers = new Headers()
  if (token !== null) headers.set('authorization', `Bearer ${token}`)
  return { headers } as unknown as NextRequest
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.MP_JWT_SECRET = 'unit-test-secret'
  redisMock.get.mockResolvedValue(null)
  redisMock.set.mockResolvedValue('OK')
  prismaMock.consumerUser.findUnique.mockResolvedValue({ ...row })
  prismaMock.consumerUser.update.mockResolvedValue({ ...row })
})

afterEach(() => {
  delete process.env.MP_JWT_SECRET
})

describe('requireConsumerAuth', () => {
  it('rejects missing or malformed tokens with 401 MP_UNAUTHORIZED', async () => {
    await expect(requireConsumerAuth(requestWith(null))).rejects.toMatchObject({ code: 'MP_UNAUTHORIZED', status: 401 })
    await expect(requireConsumerAuth(requestWith('not-a-jwt'))).rejects.toMatchObject({ code: 'MP_UNAUTHORIZED', status: 401 })
    expect(prismaMock.consumerUser.findUnique).not.toHaveBeenCalled()
  })

  it('accepts a valid token, caches the user for 60s and gates lastSeenAt hourly', async () => {
    const { token } = signConsumerToken('u1', 2, NOW)
    const auth = await requireConsumerAuth(requestWith(token))
    expect(auth.consumer).toEqual(row)
    expect(auth.payload.sub).toBe('u1')
    expect(redisMock.set).toHaveBeenCalledWith('mp:cu:u1', JSON.stringify(row), 'EX', 60)
    await flush()
    expect(redisMock.set).toHaveBeenCalledWith('mp:seen:u1', '1', 'EX', 3600, 'NX')
    expect(prismaMock.consumerUser.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { lastSeenAt: expect.any(Date) } })
  })

  it('serves the user from cache without hitting the database', async () => {
    redisMock.get.mockResolvedValue(JSON.stringify(row))
    const { token } = signConsumerToken('u1', 2, NOW)
    const auth = await requireConsumerAuth(requestWith(token))
    expect(auth.consumer).toEqual(row)
    expect(prismaMock.consumerUser.findUnique).not.toHaveBeenCalled()
  })

  it('returns 403 MP_USER_BANNED for banned users even with a valid token', async () => {
    prismaMock.consumerUser.findUnique.mockResolvedValue({ ...row, status: 'banned' })
    const { token } = signConsumerToken('u1', 2, NOW)
    await expect(requireConsumerAuth(requestWith(token))).rejects.toMatchObject({ code: 'MP_USER_BANNED', status: 403 })
  })

  it('rejects tokens whose version no longer matches', async () => {
    const { token } = signConsumerToken('u1', 1, NOW)
    await expect(requireConsumerAuth(requestWith(token))).rejects.toMatchObject({ code: 'MP_UNAUTHORIZED', status: 401 })
  })

  it('rejects unknown users', async () => {
    prismaMock.consumerUser.findUnique.mockResolvedValue(null)
    const { token } = signConsumerToken('ghost', 0, NOW)
    await expect(requireConsumerAuth(requestWith(token))).rejects.toMatchObject({ code: 'MP_UNAUTHORIZED', status: 401 })
  })

  it('skips the lastSeenAt write when the hourly gate is already held', async () => {
    redisMock.set.mockImplementation(async (key: unknown) => (String(key).startsWith('mp:seen:') ? null : 'OK'))
    const { token } = signConsumerToken('u1', 2, NOW)
    await requireConsumerAuth(requestWith(token))
    await flush()
    expect(prismaMock.consumerUser.update).not.toHaveBeenCalled()
  })

  it('still authenticates from the database when redis is down', async () => {
    redisMock.get.mockRejectedValue(new Error('redis down'))
    redisMock.set.mockRejectedValue(new Error('redis down'))
    const { token } = signConsumerToken('u1', 2, NOW)
    const auth = await requireConsumerAuth(requestWith(token))
    expect(auth.consumer.id).toBe('u1')
  })
})

describe('optionalConsumer', () => {
  it('returns null instead of throwing for anonymous, banned or stale requests', async () => {
    expect(await optionalConsumer(requestWith(null))).toBeNull()
    prismaMock.consumerUser.findUnique.mockResolvedValue({ ...row, status: 'banned' })
    const { token } = signConsumerToken('u1', 2, NOW)
    expect(await optionalConsumer(requestWith(token))).toBeNull()
    const stale = signConsumerToken('u1', 0, NOW)
    expect(await optionalConsumer(requestWith(stale.token))).toBeNull()
  })

  it('returns the consumer for a valid token', async () => {
    const { token } = signConsumerToken('u1', 2, NOW)
    const auth = await optionalConsumer(requestWith(token))
    expect(auth?.consumer.id).toBe('u1')
  })
})

describe('withConsumerTokenHeader', () => {
  it('issues X-Mp-Token only inside the renewal window', async () => {
    const fresh = signConsumerToken('u1', 2, NOW)
    const freshPayload = verifyConsumerToken(fresh.token, NOW)!
    const freshResponse = withConsumerTokenHeader(NextResponse.json({ ok: true }), { consumer: row, payload: freshPayload })
    expect(freshResponse.headers.get('X-Mp-Token')).toBeNull()

    const old = signConsumerToken('u1', 2, NOW - 25 * 24 * 3600)
    const oldPayload = verifyConsumerToken(old.token, NOW)!
    const renewedResponse = withConsumerTokenHeader(NextResponse.json({ ok: true }), { consumer: row, payload: oldPayload })
    const renewed = renewedResponse.headers.get('X-Mp-Token')
    expect(renewed).toBeTruthy()
    expect(verifyConsumerToken(renewed!, NOW)).toMatchObject({ sub: 'u1', ver: 2 })

    const anonymous = withConsumerTokenHeader(NextResponse.json({ ok: true }), null)
    expect(anonymous.headers.get('X-Mp-Token')).toBeNull()
  })
})
