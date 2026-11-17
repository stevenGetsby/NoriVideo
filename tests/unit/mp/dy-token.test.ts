import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { signConsumerToken, verifyConsumerToken } from '@/lib/mp/token'

beforeEach(() => {
  process.env.MP_JWT_SECRET = 'unit-test-secret'
})
afterEach(() => {
  delete process.env.MP_JWT_SECRET
})

describe('token aud（N2）', () => {
  it('mp token 用 dy 校验被拒，dy token 用 mp 校验也被拒', () => {
    const mp = signConsumerToken('u1', 0)
    const dy = signConsumerToken('u1', 0, undefined, 'dy')
    expect(verifyConsumerToken(mp.token, undefined, 'dy')).toBeNull()
    expect(verifyConsumerToken(dy.token)).toBeNull()
    expect(verifyConsumerToken(mp.token)).toMatchObject({ sub: 'u1', aud: 'mp' })
    expect(verifyConsumerToken(dy.token, undefined, 'dy')).toMatchObject({ sub: 'u1', aud: 'dy' })
  })

  it('不传 aud 时行为与原来一致', () => {
    const { token, expiresAt } = signConsumerToken('u2', 3)
    expect(verifyConsumerToken(token)).toMatchObject({ sub: 'u2', ver: 3, aud: 'mp' })
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(verifyConsumerToken(`${token}x`)).toBeNull()
    expect(verifyConsumerToken('not-a-token')).toBeNull()
  })

  it('aud 被篡改时签名校验失败', () => {
    const { token } = signConsumerToken('u3', 0)
    const [header, body, signature] = token.split('.')
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { aud: string }
    forged.aud = 'dy'
    const forgedBody = Buffer.from(JSON.stringify(forged)).toString('base64url')
    expect(verifyConsumerToken(`${header}.${forgedBody}.${signature}`, undefined, 'dy')).toBeNull()
  })
})
