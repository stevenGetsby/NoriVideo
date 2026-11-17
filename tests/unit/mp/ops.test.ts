import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const prismaMock = vi.hoisted(() => ({
  mpFeatureSlot: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  mpTopic: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  mpWork: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  mpChannel: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  consumerUser: { groupBy: vi.fn() },
  mpEvent: { findMany: vi.fn() },
  storyRelease: { findMany: vi.fn() },
  mpReport: { findMany: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => ({ uploadObject: vi.fn() }))
vi.mock('@/lib/storage/cdn', () => ({ mpMediaUrl: vi.fn(async (key: string) => `https://cdn.example/${key}`) }))
vi.mock('@/lib/mp/wx', () => ({ getUnlimitedWxacode: vi.fn(), generateUrlLink: vi.fn() }))

import { uploadObject } from '@/lib/storage'
import { getUnlimitedWxacode } from '@/lib/mp/wx'
import {
  archiveOpsChannel, createOpsChannel, listOpsChannels, listOpsReports, listOpsWorks,
  moveOpsSlot, saveOpsSlot, saveOpsTopic, updateOpsReport,
} from '@/lib/mp/ops'

const savedUrlLinkEnv = process.env.MP_URL_LINK_ENABLED

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.MP_URL_LINK_ENABLED
  prismaMock.$transaction.mockImplementation(async (value: unknown) => value)
  prismaMock.mpFeatureSlot.count.mockResolvedValue(0)
  prismaMock.mpFeatureSlot.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.mpFeatureSlot.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.mpTopic.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.mpTopic.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.mpWork.findUnique.mockResolvedValue({ id: 'w1', status: 'live', slug: 'abcd1234', title: '作品A' })
  prismaMock.mpWork.count.mockResolvedValue(2)
  prismaMock.mpWork.findMany.mockResolvedValue([])
  prismaMock.mpTopic.findUnique.mockResolvedValue({ id: 't1', slug: 'efgh5678', title: '专题B' })
  prismaMock.mpTopic.findMany.mockResolvedValue([])
  prismaMock.mpChannel.findMany.mockResolvedValue([])
  prismaMock.mpChannel.findUnique.mockResolvedValue(null)
  prismaMock.mpChannel.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.consumerUser.groupBy.mockResolvedValue([])
  prismaMock.mpEvent.findMany.mockResolvedValue([])
  prismaMock.storyRelease.findMany.mockResolvedValue([])
  prismaMock.mpReport.findMany.mockResolvedValue([])
  prismaMock.mpReport.groupBy.mockResolvedValue([])
  prismaMock.mpReport.updateMany.mockResolvedValue({ count: 1 })
  vi.mocked(getUnlimitedWxacode).mockResolvedValue(Buffer.from('png'))
  vi.mocked(uploadObject).mockResolvedValue(undefined as never)
})

afterEach(() => {
  if (savedUrlLinkEnv === undefined) delete process.env.MP_URL_LINK_ENABLED
  else process.env.MP_URL_LINK_ENABLED = savedUrlLinkEnv
})

describe('saveOpsSlot (D.4 推荐位)', () => {
  const body = { placement: 'home_hero', mpWorkId: 'w1' }

  it('validates placement and the work/topic either-or', async () => {
    await expect(saveOpsSlot({ ...body, placement: 'sidebar' })).rejects.toMatchObject({ code: 'MP_VALIDATION', message: '推荐位无效' })
    await expect(saveOpsSlot({ placement: 'home_hero' })).rejects.toMatchObject({ message: '作品和专题只能二选一' })
    await expect(saveOpsSlot({ ...body, topicId: 't1' })).rejects.toMatchObject({ message: '作品和专题只能二选一' })
  })

  it('only accepts existing live/scheduled works and existing topics', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue(null)
    await expect(saveOpsSlot(body)).rejects.toMatchObject({ message: '作品不存在' })
    prismaMock.mpWork.findUnique.mockResolvedValue({ status: 'draft' })
    await expect(saveOpsSlot(body)).rejects.toMatchObject({ message: '只能选择已上线或待上线的作品' })
    prismaMock.mpTopic.findUnique.mockResolvedValue(null)
    await expect(saveOpsSlot({ placement: 'home_pick', topicId: 't1' })).rejects.toMatchObject({ message: '专题不存在' })
  })

  it('caps simultaneously active slots at 5/8 with the exact copy', async () => {
    prismaMock.mpFeatureSlot.count.mockResolvedValue(5)
    await expect(saveOpsSlot(body)).rejects.toMatchObject({ code: 'MP_INVALID_STATE', message: '同时生效的推荐位不能超过 5 个' })
    prismaMock.mpFeatureSlot.count.mockResolvedValue(8)
    await expect(saveOpsSlot({ placement: 'home_pick', mpWorkId: 'w1' })).rejects.toMatchObject({ message: '同时生效的推荐位不能超过 8 个' })
    expect(prismaMock.mpFeatureSlot.create).not.toHaveBeenCalled()
  })

  it('skips the cap for disabled or out-of-window slots and excludes self on edit', async () => {
    prismaMock.mpFeatureSlot.count.mockResolvedValue(5)
    await expect(saveOpsSlot({ ...body, enabled: false })).resolves.toEqual({ ok: true })
    await expect(saveOpsSlot({ ...body, startsAt: '2099-01-01T00:00:00Z' })).resolves.toEqual({ ok: true })
    expect(prismaMock.mpFeatureSlot.count).not.toHaveBeenCalled()
    prismaMock.mpFeatureSlot.count.mockResolvedValue(4)
    await saveOpsSlot(body, 'slot1')
    expect(prismaMock.mpFeatureSlot.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ placement: 'home_hero', enabled: true, id: { not: 'slot1' } }),
    }))
  })

  it('creates trimmed optional fields and reports missing edits', async () => {
    await saveOpsSlot({ ...body, title: '  标题  ', subtitle: '', imageKey: null })
    expect(prismaMock.mpFeatureSlot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ placement: 'home_hero', mpWorkId: 'w1', topicId: null, title: '标题', subtitle: null, imageKey: null, enabled: true }),
    })
    prismaMock.mpFeatureSlot.updateMany.mockResolvedValue({ count: 0 })
    await expect(saveOpsSlot(body, 'gone')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('moveOpsSlot', () => {
  it('renumbers all siblings in the same placement', async () => {
    prismaMock.mpFeatureSlot.findUnique.mockResolvedValue({ placement: 'home_hero' })
    prismaMock.mpFeatureSlot.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    await moveOpsSlot('b', 'up')
    expect(prismaMock.mpFeatureSlot.update).toHaveBeenNthCalledWith(1, { where: { id: 'b' }, data: { sort: 0 } })
    expect(prismaMock.mpFeatureSlot.update).toHaveBeenNthCalledWith(2, { where: { id: 'a' }, data: { sort: 1 } })
    expect(prismaMock.mpFeatureSlot.update).toHaveBeenNthCalledWith(3, { where: { id: 'c' }, data: { sort: 2 } })
  })

  it('is a no-op at the edges and 404s for missing slots', async () => {
    prismaMock.mpFeatureSlot.findUnique.mockResolvedValue({ placement: 'home_hero' })
    prismaMock.mpFeatureSlot.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    await expect(moveOpsSlot('a', 'up')).resolves.toEqual({ ok: true })
    await expect(moveOpsSlot('b', 'down')).resolves.toEqual({ ok: true })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    prismaMock.mpFeatureSlot.findUnique.mockResolvedValue(null)
    await expect(moveOpsSlot('gone', 'up')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('saveOpsTopic (D.4 专题)', () => {
  const body = { title: '悬疑专题', description: '介绍', mpWorkIds: ['w1', 'w2'], status: 'draft' }

  it('requires title, description and 2–30 existing works', async () => {
    await expect(saveOpsTopic({ ...body, title: ' ' })).rejects.toMatchObject({ message: '标题需要 1–30 字' })
    await expect(saveOpsTopic({ ...body, description: ' ' })).rejects.toMatchObject({ message: '请填写介绍' })
    await expect(saveOpsTopic({ ...body, mpWorkIds: ['w1'] })).rejects.toMatchObject({ message: '作品列表需要 2–30 部' })
    await expect(saveOpsTopic({ ...body, mpWorkIds: ['w1', 'w1'] })).rejects.toMatchObject({ message: '作品列表需要 2–30 部' })
    prismaMock.mpWork.count.mockResolvedValue(1)
    await expect(saveOpsTopic(body)).rejects.toMatchObject({ message: '作品不存在' })
    prismaMock.mpWork.count.mockResolvedValue(2)
    await expect(saveOpsTopic({ ...body, status: 'archived' })).rejects.toMatchObject({ message: '状态无效' })
  })

  it('creates with an 8-char slug and retries on unique collision', async () => {
    prismaMock.mpTopic.create
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6.0.0' }))
      .mockResolvedValueOnce({})
    await expect(saveOpsTopic(body)).resolves.toEqual({ ok: true })
    expect(prismaMock.mpTopic.create).toHaveBeenCalledTimes(2)
    const data = prismaMock.mpTopic.create.mock.calls[1][0].data as { slug: string; mpWorkIds: string[] }
    expect(data.slug).toMatch(/^[0-9A-Za-z]{8}$/)
    expect(data.mpWorkIds).toEqual(['w1', 'w2'])
  })

  it('updates without touching the slug and 404s for missing topics', async () => {
    await saveOpsTopic(body, 't1')
    const call = prismaMock.mpTopic.updateMany.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> }
    expect(call.where).toEqual({ id: 't1' })
    expect(call.data).not.toHaveProperty('slug')
    prismaMock.mpTopic.updateMany.mockResolvedValue({ count: 0 })
    await expect(saveOpsTopic(body, 'gone')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('listOpsWorks (D.4 作品管理)', () => {
  it('filters by status, escapes LIKE wildcards and maps the live version', async () => {
    prismaMock.mpWork.findMany.mockResolvedValue([{
      id: 'w1', slug: 'abcd1234', title: '作品A', status: 'live', liveReleaseId: 'r1',
      playerCount: 12, ratingScore: 4.44, ratingCount: 30, createdAt: new Date('2026-11-01T00:00:00Z'),
    }])
    prismaMock.storyRelease.findMany.mockResolvedValue([{ id: 'r1', version: 3 }])
    const result = await listOpsWorks('live', 'a%b_c\\d')
    expect(prismaMock.mpWork.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'live', OR: [{ title: { contains: 'a\\%b\\_c\\\\d' } }, { slug: { contains: 'a\\%b\\_c\\\\d' } }] },
      take: 200,
    }))
    expect(result.items[0]).toMatchObject({ liveVersion: 3, playerCount: 12, ratingScore: 4.44 })
  })

  it('ignores unknown status filters', async () => {
    await listOpsWorks('hacked', null)
    expect(prismaMock.mpWork.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
  })
})

describe('reports (D.4 举报)', () => {
  it('lists open reports with reason labels, total per-work counts and deleted-work fallback', async () => {
    prismaMock.mpReport.findMany.mockResolvedValue([
      { id: 'rep1', mpWorkId: 'w1', reason: 'vulgar', detail: '描述', createdAt: new Date('2026-11-10T00:00:00Z') },
      { id: 'rep2', mpWorkId: 'gone', reason: 'unknown', detail: '', createdAt: new Date('2026-11-09T00:00:00Z') },
    ])
    prismaMock.mpWork.findMany.mockResolvedValue([{ id: 'w1', title: '作品A' }])
    prismaMock.mpReport.groupBy.mockResolvedValue([{ mpWorkId: 'w1', _count: { _all: 5 } }, { mpWorkId: 'gone', _count: { _all: 1 } }])
    const result = await listOpsReports()
    expect(prismaMock.mpReport.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'open' } }))
    expect(result.items[0]).toMatchObject({ workTitle: '作品A', reasonLabel: '低俗色情', workReportCount: 5 })
    expect(result.items[1]).toMatchObject({ workTitle: '作品已删除', reasonLabel: 'unknown', workReportCount: 1 })
  })

  it('only resolves or dismisses open reports and records the admin', async () => {
    await expect(updateOpsReport('rep1', 'open', 'admin1')).rejects.toMatchObject({ message: '状态无效' })
    await updateOpsReport('rep1', 'resolved', 'admin1')
    expect(prismaMock.mpReport.updateMany).toHaveBeenCalledWith({
      where: { id: 'rep1', status: 'open' },
      data: { status: 'resolved', handledById: 'admin1', handledAt: expect.any(Date) },
    })
    prismaMock.mpReport.updateMany.mockResolvedValue({ count: 0 })
    await expect(updateOpsReport('rep1', 'dismissed', 'admin1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('ops channels (D.4 渠道码)', () => {
  function channelRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'c1', code: 'abc234', name: '渠道', kind: 'ops', mpWorkId: null, topicId: null,
      createdByUserId: 'admin1', wxacodeKey: 'mp/wxacode/c/abc234.png', urlLink: null, urlLinkExpiresAt: null,
      archived: false, createdAt: new Date('2026-11-01T00:00:00Z'), ...overrides,
    }
  }

  it('creates home channels with kind ops', async () => {
    prismaMock.mpChannel.create.mockResolvedValue(channelRow())
    await expect(createOpsChannel({ name: '首页渠道' }, 'admin1')).resolves.toEqual({ ok: true })
    expect(getUnlimitedWxacode).toHaveBeenCalledWith(expect.stringMatching(/^c=[23456789abcdefghijkmnpqrstuvwxyz]{6}$/), 'pages/home/index')
    expect(prismaMock.mpChannel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'ops', name: '首页渠道', mpWorkId: null, topicId: null, createdByUserId: 'admin1' }),
    })
  })

  it('lists targets and 30-day stats per channel', async () => {
    prismaMock.mpChannel.findMany.mockResolvedValue([
      channelRow({ id: 'c1', mpWorkId: 'w1' }),
      channelRow({ id: 'c2', topicId: 't1' }),
      channelRow({ id: 'c3' }),
    ])
    prismaMock.mpWork.findMany.mockResolvedValue([{ id: 'w1', slug: 'abcd1234', title: '作品A' }])
    prismaMock.mpTopic.findMany.mockResolvedValue([{ id: 't1', slug: 'efgh5678', title: '专题B' }])
    prismaMock.consumerUser.groupBy.mockResolvedValue([{ firstChannelId: 'c1', _count: { _all: 3 } }])
    prismaMock.mpEvent.findMany.mockResolvedValue([{ consumerId: 'u1', channelId: 'c1' }, { consumerId: 'u2', channelId: 'c1' }])
    const result = await listOpsChannels()
    expect(prismaMock.mpChannel.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: 'ops', archived: false } }))
    expect(result.channels.map((row) => row.target)).toEqual(['作品A', '专题B', '首页'])
    expect(result.channels[0]).toMatchObject({ newUsers30d: 3, players30d: 2, path: 'pages/work/index?w=abcd1234&c=abc234' })
    expect(result.channels[1].path).toBe('pages/topic/index?t=efgh5678&c=abc234')
    expect(result.channels[2].path).toBe('pages/home/index?c=abc234')
  })

  it('archives only unarchived ops channels', async () => {
    await expect(archiveOpsChannel('c1')).resolves.toEqual({ ok: true })
    expect(prismaMock.mpChannel.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', kind: 'ops', archived: false }, data: { archived: true } })
    prismaMock.mpChannel.updateMany.mockResolvedValue({ count: 0 })
    await expect(archiveOpsChannel('creator-channel')).rejects.toMatchObject({ message: '渠道不存在' })
  })
})
