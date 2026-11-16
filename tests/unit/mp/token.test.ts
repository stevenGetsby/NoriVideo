import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MP_TOKEN_RENEW_WINDOW_SEC, signConsumerToken, tokenNeedsRenewal, verifyConsumerToken } from '@/lib/mp/token'

const NOW = 1_800_000_000
const TTL_SEC = 30 * 24 * 3600

function craft(payload: object, header: object = { alg: 'HS256', typ: 'JWT' }): string {
  const head = Buffer.from(JSON.stringify(header)).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', process.env.MP_JWT_SECRET || '').update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${signature}`
}

beforeEach(() => {
  process.env.MP_JWT_SECRET = 'unit-test-secret'
})

afterEach(() => {
  delete process.env.MP_JWT_SECRET
})

describe('mp consumer token', () => {
  it('signs and verifies a 30 day HS256 token', () => {
    const { token, expiresAt } = signConsumerToken('u1', 3, NOW)
    const payload = verifyConsumerToken(token, NOW)
    expect(payload).toEqual({ sub: 'u1', ver: 3, aud: 'mp', iat: NOW, exp: NOW + TTL_SEC })
    expect(expiresAt).toBe(new Date((NOW + TTL_SEC) * 1000).toISOString())
  })

  it('rejects a tampered payload', () => {
    const { token } = signConsumerToken('u1', 3, NOW)
    const [head, , signature] = token.split('.')
    const forgedBody = Buffer.from(JSON.stringify({ sub: 'u2', ver: 3, aud: 'mp', iat: NOW, exp: NOW + TTL_SEC })).toString('base64url')
    expect(verifyConsumerToken(`${head}.${forgedBody}.${signature}`, NOW)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const { token } = signConsumerToken('u1', 3, NOW)
    const flipped = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`
    expect(verifyConsumerToken(flipped, NOW)).toBeNull()
  })

  it('rejects expired tokens at the exact expiry second', () => {
    const { token } = signConsumerToken('u1', 0, NOW)
    expect(verifyConsumerToken(token, NOW + TTL_SEC - 1)).not.toBeNull()
    expect(verifyConsumerToken(token, NOW + TTL_SEC)).toBeNull()
  })

  it('rejects wrong audience, wrong algorithm and malformed tokens', () => {
    expect(verifyConsumerToken(craft({ sub: 'u1', ver: 0, aud: 'other', iat: NOW, exp: NOW + TTL_SEC }), NOW)).toBeNull()
    expect(verifyConsumerToken(craft({ sub: 'u1', ver: 0, aud: 'mp', iat: NOW, exp: NOW + TTL_SEC }, { alg: 'none', typ: 'JWT' }), NOW)).toBeNull()
    expect(verifyConsumerToken(craft({ sub: 'u1', ver: -1, aud: 'mp', iat: NOW, exp: NOW + TTL_SEC }), NOW)).toBeNull()
    expect(verifyConsumerToken(craft({ sub: '', ver: 0, aud: 'mp', iat: NOW, exp: NOW + TTL_SEC }), NOW)).toBeNull()
    for (const malformed of ['', 'abc', 'a.b', 'a.b.c.d', '...']) {
      expect(verifyConsumerToken(malformed, NOW)).toBeNull()
    }
  })

  it('fails closed when the secret is missing', () => {
    const { token } = signConsumerToken('u1', 0, NOW)
    delete process.env.MP_JWT_SECRET
    expect(verifyConsumerToken(token, NOW)).toBeNull()
    expect(() => signConsumerToken('u1', 0, NOW)).toThrow()
  })

  it('flags renewal only inside the last 7 days', () => {
    const { token } = signConsumerToken('u1', 0, NOW)
    const payload = verifyConsumerToken(token, NOW)
    expect(payload).not.toBeNull()
    expect(tokenNeedsRenewal(payload!, NOW)).toBe(false)
    expect(tokenNeedsRenewal(payload!, NOW + TTL_SEC - MP_TOKEN_RENEW_WINDOW_SEC)).toBe(false)
    expect(tokenNeedsRenewal(payload!, NOW + TTL_SEC - MP_TOKEN_RENEW_WINDOW_SEC + 1)).toBe(true)
  })
})
