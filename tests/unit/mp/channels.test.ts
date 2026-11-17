import { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  mpChannel: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  mpWork: { findUnique: vi.fn() },
  mpTopic: { findUnique: vi.fn() },
  consumerUser: { groupBy: vi.fn() },
  mpEvent: { findMany: vi.fn() },
}))
const storageMock = vi.hoisted(() => ({ uploadObject: vi.fn() }))
const cdnMock = vi.hoisted(() => ({ mpMediaUrl: vi.fn() }))
const wxMock = vi.hoisted(() => ({ getUnlimitedWxacode: vi.fn(), generateUrlLink: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/storage/cdn', () => cdnMock)
vi.mock('@/lib/mp/wx', () => wxMock)

import { archiveChannel, createChannel, listChannels, renewChannelUrlLink } from '@/lib/mp/channels'

const CODE_PATTERN = /^[23456789abcdefghijkmnpqrstuvwxyz]{6}$/
const WORK = { id: 'mpw1', slug: 'abcd1234', status: 'live' }
const ENV_KEY = 'MP_URL_LINK_ENABLED'
let savedEnv: string | undefined

function channelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch1', code: 'abc234', name: '公众号推文', kind: 'creator', mpWorkId: 'mpw1', topicId: null,
    createdByUserId: 'u1', wxacodeKey: 'mp/wxacode/c/abc234.png', urlLink: null, urlLinkExpiresAt: null,
    archived: false, createdAt: new Date('2026-11-01T00:00:00Z'), ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  savedEnv = process.env[ENV_KEY]
  delete process.env[ENV_KEY]
  prismaMock.mpWork.findUnique.mockResolvedValue({ ...WORK })
  prismaMock.mpTopic.findUnique.mockResolvedValue({ slug: 'topic001' })
  prismaMock.mpChannel.count.mockResolvedValue(0)
  prismaMock.mpChannel.findUnique.mockResolvedValue(null)
  prismaMock.mpChannel.findFirst.mockResolvedValue(channelRow())
  prismaMock.mpChannel.findMany.mockResolvedValue([])
  prismaMock.mpChannel.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => channelRow(data))
  prismaMock.mpChannel.update.mockResolvedValue(channelRow())
  prismaMock.mpChannel.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.consumerUser.groupBy.mockResolvedValue([])
  prismaMock.mpEvent.findMany.mockResolvedValue([])
  storageMock.uploadObject.mockResolvedValue(undefined)
  cdnMock.mpMediaUrl.mockImplementation(async (key: string) => `https://cdn.example/${key}`)
  wxMock.getUnlimitedWxacode.mockResolvedValue(Buffer.from('png'))
  wxMock.generateUrlLink.mockResolvedValue('https://wx.example/link')
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = savedEnv
})

describe('createChannel (H.4)', () => {
  it('creates a work channel with compound scene, PNG key and base32 code', async () => {
    const row = await createChannel({ kind: 'creator', name: '公众号推文', mpWorkId: 'mpw1', userId: 'u1' })
    expect(row.code).toMatch(CODE_PATTERN)
    expect(wxMock.getUnlimitedWxacode).toHaveBeenCalledWith(`c=${row.code}&w=abcd1234`, 'pages/work/index')
    expect(storageMock.uploadObject).toHaveBeenCalledWith(Buffer.from('png'), `mp/wxacode/c/${row.code}.png`, undefined, 'image/png')
    expect(prismaMock.mpChannel.create).toHaveBeenCalledWith({
      data: {
        code: row.code, name: '公众号推文', kind: 'creator', mpWorkId: 'mpw1', topicId: null,
        createdByUserId: 'u1', wxacodeKey: `mp/wxacode/c/${row.code}.png`, urlLink: null, urlLinkExpiresAt: null,
      },
    })
    expect(wxMock.generateUrlLink).not.toHaveBeenCalled()
  })

  it('rejects names outside 1–20 chars before any WeChat call', async () => {
    await expect(createChannel({ kind: 'creator', name: '', mpWorkId: 'mpw1', userId: 'u1' })).rejects.toMatchObject({ code: 'MP_VALIDATION', status: 400 })
    await expect(createChannel({ kind: 'creator', name: '   ', mpWorkId: 'mpw1', userId: 'u1' })).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    await expect(createChannel({ kind: 'creator', name: 'x'.repeat(21), mpWorkId: 'mpw1', userId: 'u1' })).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    expect(wxMock.getUnlimitedWxacode).not.toHaveBeenCalled()
  })

  it('only allows live or scheduled works', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue({ ...WORK, status: 'draft' })
    await expect(createChannel({ kind: 'creator', name: '推文', mpWorkId: 'mpw1', userId: 'u1' })).rejects.toMatchObject({ code: 'MP_INVALID_STATE', status: 409 })
    prismaMock.mpWork.findUnique.mockResolvedValue(null)
    await expect(createChannel({ kind: 'creator', name: '推文', mpWorkId: 'mpw1', userId: 'u1' })).rejects.toMatchObject({ code: 'MP_VALIDATION' })
  })

  it('caps unarchived channels at 50 per work', async () => {
    prismaMock.mpChannel.count.mockResolvedValue(50)
    await expect(createChannel({ kind: 'creator', name: '推文', mpWorkId: 'mpw1', userId: 'u1' })).rejects.toMatchObject({ code: 'MP_INVALID_STATE' })
    expect(prismaMock.mpChannel.count).toHaveBeenCalledWith({ where: { mpWorkId: 'mpw1', archived: false } })
    expect(wxMock.getUnlimitedWxacode).not.toHaveBeenCalled()
  })

  it('generates a 30-day URL Link when MP_URL_LINK_ENABLED=1', async () => {
    process.env[ENV_KEY] = '1'
    const before = Date.now()
    const row = await createChannel({ kind: 'creator', name: '推文', mpWorkId: 'mpw1', userId: 'u1' })
    expect(wxMock.generateUrlLink).toHaveBeenCalledWith('pages/work/index', `w=abcd1234&c=${row.code}`)
    const data = prismaMock.mpChannel.create.mock.calls[0][0].data as { urlLink: string; urlLinkExpiresAt: Date }
    expect(data.urlLink).toBe('https://wx.example/link')
    expect(data.urlLinkExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 24 * 3600 * 1000)
    expect(data.urlLinkExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 24 * 3600 * 1000)
  })

  it('creates a home channel for ops without work or topic', async () => {
    const row = await createChannel({ kind: 'ops', name: '线下物料', userId: 'u1' })
    expect(wxMock.getUnlimitedWxacode).toHaveBeenCalledWith(`c=${row.code}`, 'pages/home/index')
    expect(prismaMock.mpChannel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'ops', mpWorkId: null, topicId: null }),
    })
  })

  it('creates a topic channel with t in the scene', async () => {
    const row = await createChannel({ kind: 'ops', name: '专题投放', topicId: 'tp1', userId: 'u1' })
    expect(wxMock.getUnlimitedWxacode).toHaveBeenCalledWith(`c=${row.code}&t=topic001`, 'pages/topic/index')
    expect(prismaMock.mpChannel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mpWorkId: null, topicId: 'tp1' }),
    })
  })

  it('retries when the generated code is already taken', async () => {
    prismaMock.mpChannel.findUnique.mockResolvedValueOnce({ id: 'other' }).mockResolvedValue(null)
    await createChannel({ kind: 'creator', name: '推文', mpWorkId: 'mpw1', userId: 'u1' })
    expect(prismaMock.mpChannel.findUnique).toHaveBeenCalledTimes(2)
    expect(prismaMock.mpChannel.create).toHaveBeenCalledTimes(1)
  })

  it('retries the whole creation on a P2002 race', async () => {
    prismaMock.mpChannel.create
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.0.0' }))
      .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => channelRow(data))
    const row = await createChannel({ kind: 'creator', name: '推文', mpWorkId: 'mpw1', userId: 'u1' })
    expect(row.code).toMatch(CODE_PATTERN)
    expect(prismaMock.mpChannel.create).toHaveBeenCalledTimes(2)
  })
})

describe('listChannels (H.4 table)', () => {
  it('is unavailable when the work is missing or not live/scheduled', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue(null)
    expect(await listChannels('w1')).toEqual({ available: false, slug: null, urlLinkEnabled: false, channels: [] })
    prismaMock.mpWork.findUnique.mockResolvedValue({ ...WORK, status: 'offline' })
    expect((await listChannels('w1')).available).toBe(false)
    expect(prismaMock.mpChannel.findMany).not.toHaveBeenCalled()
  })

  it('maps rows with signed PNG url, path and 30-day stats', async () => {
    prismaMock.mpChannel.findMany.mockResolvedValue([channelRow()])
    prismaMock.consumerUser.groupBy.mockResolvedValue([{ firstChannelId: 'ch1', _count: { _all: 3 } }])
    prismaMock.mpEvent.findMany.mockResolvedValue([
      { consumerId: 'c1', channelId: 'ch1' },
      { consumerId: 'c2', channelId: 'ch1' },
    ])
    const overview = await listChannels('w1')
    expect(overview.available).toBe(true)
    expect(overview.slug).toBe('abcd1234')
    expect(overview.channels).toEqual([{
      id: 'ch1', code: 'abc234', name: '公众号推文', createdAt: '2026-11-01T00:00:00.000Z',
      wxacodeUrl: 'https://cdn.example/mp/wxacode/c/abc234.png',
      path: 'pages/work/index?w=abcd1234&c=abc234',
      urlLink: null, urlLinkExpiresAt: null, newUsers30d: 3, players30d: 2,
    }])
    expect(prismaMock.mpEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ name: 'play_start', consumerId: { not: null } }),
      distinct: ['consumerId', 'channelId'],
    }))
  })

  it('skips stats queries when there are no channels', async () => {
    const overview = await listChannels('w1')
    expect(overview.channels).toEqual([])
    expect(prismaMock.consumerUser.groupBy).not.toHaveBeenCalled()
    expect(prismaMock.mpEvent.findMany).not.toHaveBeenCalled()
  })
})

describe('renewChannelUrlLink (H.4 auto-renew)', () => {
  it('rejects when URL Link is disabled', async () => {
    await expect(renewChannelUrlLink('w1', 'ch1')).rejects.toMatchObject({ code: 'MP_INVALID_STATE' })
    expect(prismaMock.mpChannel.findFirst).not.toHaveBeenCalled()
  })

  it('returns a fresh link untouched', async () => {
    process.env[ENV_KEY] = '1'
    const expiresAt = new Date(Date.now() + 20 * 24 * 3600 * 1000)
    prismaMock.mpChannel.findFirst.mockResolvedValue(channelRow({ urlLink: 'https://wx.example/old', urlLinkExpiresAt: expiresAt }))
    const result = await renewChannelUrlLink('w1', 'ch1')
    expect(result).toEqual({ urlLink: 'https://wx.example/old', urlLinkExpiresAt: expiresAt.toISOString() })
    expect(wxMock.generateUrlLink).not.toHaveBeenCalled()
    expect(prismaMock.mpChannel.update).not.toHaveBeenCalled()
  })

  it('regenerates when less than one day remains', async () => {
    process.env[ENV_KEY] = '1'
    prismaMock.mpChannel.findFirst.mockResolvedValue(channelRow({
      urlLink: 'https://wx.example/old', urlLinkExpiresAt: new Date(Date.now() + 12 * 3600 * 1000),
    }))
    const result = await renewChannelUrlLink('w1', 'ch1')
    expect(wxMock.generateUrlLink).toHaveBeenCalledWith('pages/work/index', 'w=abcd1234&c=abc234')
    expect(result.urlLink).toBe('https://wx.example/link')
    expect(prismaMock.mpChannel.update).toHaveBeenCalledWith({
      where: { id: 'ch1' },
      data: { urlLink: 'https://wx.example/link', urlLinkExpiresAt: expect.any(Date) },
    })
  })

  it('regenerates when the link is missing entirely', async () => {
    process.env[ENV_KEY] = '1'
    prismaMock.mpChannel.findFirst.mockResolvedValue(channelRow())
    const result = await renewChannelUrlLink('w1', 'ch1')
    expect(result.urlLink).toBe('https://wx.example/link')
  })

  it('rejects archived or foreign channels', async () => {
    process.env[ENV_KEY] = '1'
    prismaMock.mpChannel.findFirst.mockResolvedValue(channelRow({ archived: true }))
    await expect(renewChannelUrlLink('w1', 'ch1')).rejects.toMatchObject({ code: 'MP_INVALID_STATE' })
    prismaMock.mpChannel.findFirst.mockResolvedValue(null)
    await expect(renewChannelUrlLink('w1', 'ch1')).rejects.toMatchObject({ code: 'MP_VALIDATION' })
  })
})

describe('archiveChannel', () => {
  it('archives an active channel of the work', async () => {
    expect(await archiveChannel('w1', 'ch1')).toEqual({ ok: true })
    expect(prismaMock.mpChannel.updateMany).toHaveBeenCalledWith({
      where: { id: 'ch1', mpWorkId: 'mpw1', archived: false },
      data: { archived: true },
    })
  })

  it('rejects when nothing matched', async () => {
    prismaMock.mpChannel.updateMany.mockResolvedValue({ count: 0 })
    await expect(archiveChannel('w1', 'ch1')).rejects.toMatchObject({ code: 'MP_VALIDATION' })
    prismaMock.mpWork.findUnique.mockResolvedValue(null)
    await expect(archiveChannel('w1', 'ch1')).rejects.toMatchObject({ code: 'MP_VALIDATION' })
  })
})
