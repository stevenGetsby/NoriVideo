import { afterEach, describe, expect, it, vi } from 'vitest'

const warn = vi.hoisted(() => vi.fn())

vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), event: vi.fn(), child: vi.fn() }),
}))
vi.mock('@/lib/crypto-utils', () => ({ decryptApiKey: (value: string) => `plain-${value}` }))

import { dyCode2Session } from '@/lib/mp/dy/session'

const APP = { id: 'a1', appId: 'ttTest0000000000', mpWorkId: 'mpw1', name: '测试', status: 'active', releaseIds: [], secretEnc: 'enc-secret' }

function mockFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  warn.mockClear()
})

describe('dyCode2Session（N3）', () => {
  it('40018 / 40019 映射成 MP_VALIDATION', async () => {
    mockFetch({ error: 40018 })
    await expect(dyCode2Session(APP, 'code1', null)).rejects.toMatchObject({ code: 'MP_VALIDATION', message: '登录凭证无效，请重试' })
    mockFetch({ errcode: 40019 })
    await expect(dyCode2Session(APP, 'code1', null)).rejects.toMatchObject({ code: 'MP_VALIDATION' })
  })

  it('其他错误码映射成 MP_DY_UNAVAILABLE', async () => {
    mockFetch({ error: 40001 })
    await expect(dyCode2Session(APP, 'code1', null)).rejects.toMatchObject({ code: 'MP_DY_UNAVAILABLE' })
    mockFetch({ errcode: -1 })
    await expect(dyCode2Session(APP, null, 'anon1')).rejects.toMatchObject({ code: 'MP_DY_UNAVAILABLE' })
  })

  it('网络错误映射成 MP_DY_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    await expect(dyCode2Session(APP, 'code1', null)).rejects.toMatchObject({ code: 'MP_DY_UNAVAILABLE' })
  })

  it('openid 和 anonymous_openid 都为空时抛 MP_VALIDATION', async () => {
    mockFetch({ error: 0 })
    await expect(dyCode2Session(APP, 'code1', 'anon1')).rejects.toMatchObject({ code: 'MP_VALIDATION' })
  })

  it('成功时返回 openid/anonOpenid/unionid，丢弃 session_key', async () => {
    mockFetch({ error: 0, openid: 'o1', anonymous_openid: 'ao1', unionid: 'u1', session_key: 'sk-should-drop' })
    const session = await dyCode2Session(APP, 'code1', 'anon1')
    expect(session).toEqual({ openid: 'o1', anonOpenid: 'ao1', unionid: 'u1' })
  })

  it('anonymous_code 为空时不带该参数', async () => {
    const fetchMock = mockFetch({ error: 0, openid: 'o1' })
    await dyCode2Session(APP, 'code1', null)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('code=code1')
    expect(url).not.toContain('anonymous_code')
  })

  it('日志里没有 secret，只有 appId 和 errcode', async () => {
    mockFetch({ error: 40001 })
    await expect(dyCode2Session(APP, 'code1', null)).rejects.toMatchObject({ code: 'MP_DY_UNAVAILABLE' })
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain('plain-enc-secret')
    expect(logged).not.toContain('enc-secret')
    expect(logged).not.toContain('code1')
    expect(logged).toContain('ttTest0000000000')
    expect(logged).toContain('40001')
  })
})
