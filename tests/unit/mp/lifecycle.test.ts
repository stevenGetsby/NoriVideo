import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }))
const redisMock = vi.hoisted(() => ({ incr: vi.fn(async () => 1), rpush: vi.fn(async (...args: unknown[]) => args.length) }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn(), child: vi.fn() }),
}))

import {
  approveRelease,
  banWork,
  goLive,
  offlineWork,
  onlineWork,
  rejectRelease,
  unbanWork,
} from '@/lib/mp/release/lifecycle'

type Row = Record<string, unknown>
interface Seed { releases: Record<string, Row>; works: Record<string, Row> }

function installDb(seed: Seed) {
  const tx = {
    storyRelease: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (seed.releases[where.id] ? { ...seed.releases[where.id] } : null)),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        Object.assign(seed.releases[where.id], data)
        return seed.releases[where.id]
      }),
    },
    mpWork: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; workId?: string } }) => {
        const row = where.id ? seed.works[where.id] : Object.values(seed.works).find((work) => work.workId === where.workId)
        return row ? { ...row } : null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        Object.assign(seed.works[where.id], data)
        return seed.works[where.id]
      }),
    },
  }
  prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx))
  return tx
}

const release = (overrides: Row = {}): Row => ({ id: 'r1', workId: 'w1', status: 'reviewing', chapterCount: 2, ...overrides })
const work = (overrides: Row = {}): Row => ({
  id: 'm1', workId: 'w1', status: 'live', liveReleaseId: 'r0', pendingReleaseId: null,
  firstLiveAt: new Date('2026-11-01T00:00:00.000Z'), scheduledAt: null, reservable: true, ...overrides,
})

const notifyPayloads = () => redisMock.rpush.mock.calls.map((call) => JSON.parse(call[1] as string))
const invalidState = { name: 'MpApiError', code: 'MP_INVALID_STATE', status: 409, message: '当前状态不能执行此操作' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('approveRelease', () => {
  it('approves a reviewing release and retires the old live release in one transaction', async () => {
    const seed: Seed = {
      releases: { r1: release(), r0: release({ id: 'r0', status: 'live', chapterCount: 1 }) },
      works: { m1: work() },
    }
    const tx = installDb(seed)
    const outcome = await approveRelease('r1', 'admin1')
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ scheduled: false, mpWorkId: 'm1', firstLive: false, chapterUpdate: true })
    expect(seed.releases.r1).toMatchObject({ status: 'live', reviewedById: 'admin1' })
    expect(seed.releases.r1.reviewedAt).toBeInstanceOf(Date)
    expect(seed.releases.r1.liveAt).toBeInstanceOf(Date)
    expect(seed.releases.r0).toMatchObject({ status: 'retired' })
    expect(seed.releases.r0.retiredAt).toBeInstanceOf(Date)
    expect(seed.works.m1).toMatchObject({ liveReleaseId: 'r1', pendingReleaseId: null, status: 'live' })
    expect(tx.storyRelease.update).toHaveBeenCalledTimes(3)
    expect(redisMock.incr).toHaveBeenCalledWith('mp:cache:ver')
    expect(notifyPayloads()).toEqual([
      { kind: 'chapter_update', mpWorkId: 'm1', releaseId: 'r1', enqueuedAt: expect.any(String) },
    ])
    expect(redisMock.rpush).toHaveBeenCalledWith('mp:notify:queue', expect.any(String))
  })

  it('enqueues work_live and stamps firstLiveAt on the first publish', async () => {
    const seed: Seed = {
      releases: { r1: release({ chapterCount: 1 }) },
      works: { m1: work({ status: 'draft', liveReleaseId: null, firstLiveAt: null }) },
    }
    installDb(seed)
    const outcome = await approveRelease('r1', 'admin1')
    expect(outcome).toMatchObject({ scheduled: false, firstLive: true, chapterUpdate: false })
    expect(seed.works.m1.firstLiveAt).toBeInstanceOf(Date)
    expect(notifyPayloads()).toEqual([
      { kind: 'work_live', mpWorkId: 'm1', releaseId: 'r1', enqueuedAt: expect.any(String) },
    ])
  })

  it('schedules a first release when scheduledAt is in the future', async () => {
    const seed: Seed = {
      releases: { r1: release() },
      works: { m1: work({ status: 'draft', liveReleaseId: null, firstLiveAt: null, scheduledAt: new Date(Date.now() + 86_400_000) }) },
    }
    installDb(seed)
    const outcome = await approveRelease('r1', 'admin1')
    expect(outcome).toMatchObject({ scheduled: true, mpWorkId: 'm1' })
    expect(seed.releases.r1.status).toBe('approved')
    expect(seed.works.m1).toMatchObject({ pendingReleaseId: 'r1', status: 'scheduled', liveReleaseId: null })
    expect(redisMock.rpush).not.toHaveBeenCalled()
    expect(redisMock.incr).toHaveBeenCalledWith('mp:cache:ver')
  })

  it('keeps a scheduled first release draft when not reservable', async () => {
    const seed: Seed = {
      releases: { r1: release() },
      works: { m1: work({ status: 'draft', liveReleaseId: null, firstLiveAt: null, reservable: false, scheduledAt: new Date(Date.now() + 86_400_000) }) },
    }
    installDb(seed)
    await approveRelease('r1', 'admin1')
    expect(seed.works.m1.status).toBe('draft')
  })

  it('goes live immediately when scheduledAt has passed', async () => {
    const seed: Seed = {
      releases: { r1: release() },
      works: { m1: work({ status: 'draft', liveReleaseId: null, firstLiveAt: null, scheduledAt: new Date(Date.now() - 1000) }) },
    }
    installDb(seed)
    const outcome = await approveRelease('r1', 'admin1')
    expect(outcome).toMatchObject({ scheduled: false, firstLive: true })
    expect(seed.releases.r1.status).toBe('live')
    expect(seed.works.m1.status).toBe('live')
  })

  it('rejects every non-reviewing status with 409 MP_INVALID_STATE', async () => {
    for (const status of ['building', 'build_failed', 'approved', 'live', 'rejected', 'retired']) {
      const seed: Seed = { releases: { r1: release({ status }) }, works: { m1: work() } }
      const tx = installDb(seed)
      await expect(approveRelease('r1', 'admin1')).rejects.toMatchObject(invalidState)
      expect(tx.storyRelease.update).not.toHaveBeenCalled()
      expect(redisMock.incr).not.toHaveBeenCalled()
    }
  })

  it('returns NOT_FOUND for a missing release or listing', async () => {
    installDb({ releases: {}, works: { m1: work() } })
    await expect(approveRelease('r1', 'admin1')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    installDb({ releases: { r1: release() }, works: {} })
    await expect(approveRelease('r1', 'admin1')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })
})

describe('goLive', () => {
  it('publishes an approved release without notifications when nothing changed', async () => {
    const seed: Seed = {
      releases: { r1: release({ status: 'approved' }), r0: release({ id: 'r0', status: 'live', chapterCount: 2 }) },
      works: { m1: work() },
    }
    installDb(seed)
    const outcome = await goLive('r1')
    expect(outcome).toEqual({ mpWorkId: 'm1', firstLive: false, chapterUpdate: false })
    expect(seed.releases.r0.status).toBe('retired')
    expect(seed.releases.r1.status).toBe('live')
    expect(seed.works.m1.liveReleaseId).toBe('r1')
    expect(redisMock.incr).toHaveBeenCalledWith('mp:cache:ver')
    expect(redisMock.rpush).not.toHaveBeenCalled()
  })

  it('notifies chapter_update only when the chapter count grows', async () => {
    const seed: Seed = {
      releases: { r1: release({ status: 'approved', chapterCount: 3 }), r0: release({ id: 'r0', status: 'live', chapterCount: 2 }) },
      works: { m1: work() },
    }
    installDb(seed)
    const outcome = await goLive('r1')
    expect(outcome.chapterUpdate).toBe(true)
    expect(notifyPayloads()[0]).toMatchObject({ kind: 'chapter_update', mpWorkId: 'm1', releaseId: 'r1' })
  })

  it('rejects non-approved releases with 409 MP_INVALID_STATE', async () => {
    for (const status of ['building', 'reviewing', 'rejected', 'live', 'retired']) {
      installDb({ releases: { r1: release({ status }) }, works: { m1: work() } })
      await expect(goLive('r1')).rejects.toMatchObject(invalidState)
    }
  })
})

describe('rejectRelease', () => {
  it('rejects a reviewing release with the trimmed note', async () => {
    const seed: Seed = { releases: { r1: release() }, works: { m1: work() } }
    installDb(seed)
    await rejectRelease('r1', 'admin1', '  内容违规了  ')
    expect(seed.releases.r1).toMatchObject({ status: 'rejected', reviewNote: '内容违规了', reviewedById: 'admin1' })
    expect(seed.releases.r1.reviewedAt).toBeInstanceOf(Date)
  })

  it('accepts notes of exactly 5 and 200 codepoints', async () => {
    for (const note of ['五字原因啊', '长'.repeat(200)]) {
      const seed: Seed = { releases: { r1: release() }, works: { m1: work() } }
      installDb(seed)
      await rejectRelease('r1', 'admin1', note)
      expect(seed.releases.r1.status).toBe('rejected')
    }
  })

  it('rejects notes outside 5–200 codepoints with MP_VALIDATION', async () => {
    for (const note of ['短', '长'.repeat(201)]) {
      const seed: Seed = { releases: { r1: release() }, works: { m1: work() } }
      const tx = installDb(seed)
      await expect(rejectRelease('r1', 'admin1', note)).rejects.toMatchObject({
        name: 'MpApiError', code: 'MP_VALIDATION', status: 400, message: '驳回原因需要 5–200 字',
      })
      expect(tx.storyRelease.update).not.toHaveBeenCalled()
    }
  })

  it('rejects non-reviewing releases with 409 MP_INVALID_STATE', async () => {
    for (const status of ['building', 'approved', 'live', 'rejected', 'retired']) {
      installDb({ releases: { r1: release({ status }) }, works: { m1: work() } })
      await expect(rejectRelease('r1', 'admin1', '内容违规了')).rejects.toMatchObject(invalidState)
    }
  })
})

describe('offlineWork / onlineWork', () => {
  it('takes a live work offline and clears the cache', async () => {
    const seed: Seed = { releases: {}, works: { m1: work({ status: 'live' }) } }
    installDb(seed)
    await offlineWork('m1')
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(seed.works.m1.status).toBe('offline')
    expect(redisMock.incr).toHaveBeenCalledWith('mp:cache:ver')
  })

  it('refuses to offline works that are not live', async () => {
    for (const status of ['draft', 'scheduled', 'offline', 'banned']) {
      installDb({ releases: {}, works: { m1: work({ status }) } })
      await expect(offlineWork('m1')).rejects.toMatchObject(invalidState)
      expect(redisMock.incr).not.toHaveBeenCalled()
    }
  })

  it('brings an offline work with a live release back online', async () => {
    const seed: Seed = { releases: {}, works: { m1: work({ status: 'offline', liveReleaseId: 'r0' }) } }
    installDb(seed)
    await onlineWork('m1')
    expect(seed.works.m1.status).toBe('live')
    expect(redisMock.incr).toHaveBeenCalledWith('mp:cache:ver')
  })

  it('refuses online without a live release or from a non-offline status', async () => {
    installDb({ releases: {}, works: { m1: work({ status: 'offline', liveReleaseId: null }) } })
    await expect(onlineWork('m1')).rejects.toMatchObject(invalidState)
    for (const status of ['draft', 'scheduled', 'live', 'banned']) {
      installDb({ releases: {}, works: { m1: work({ status }) } })
      await expect(onlineWork('m1')).rejects.toMatchObject(invalidState)
    }
  })

  it('returns NOT_FOUND for a missing work', async () => {
    installDb({ releases: {}, works: {} })
    await expect(offlineWork('m1')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(onlineWork('m1')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })
})

describe('banWork / unbanWork', () => {
  it('bans from any status with the trimmed reason and clears the cache', async () => {
    for (const status of ['draft', 'scheduled', 'live', 'offline']) {
      vi.clearAllMocks()
      const seed: Seed = { releases: {}, works: { m1: work({ status }) } }
      installDb(seed)
      await banWork('m1', '  违规内容  ', 'admin1')
      expect(seed.works.m1).toMatchObject({ status: 'banned', bannedReason: '违规内容' })
      expect(redisMock.incr).toHaveBeenCalledWith('mp:cache:ver')
    }
  })

  it('requires a reason of at most 200 codepoints', async () => {
    for (const reason of ['', '   ', '长'.repeat(201)]) {
      const seed: Seed = { releases: {}, works: { m1: work() } }
      const tx = installDb(seed)
      await expect(banWork('m1', reason, 'admin1')).rejects.toMatchObject({
        name: 'MpApiError', code: 'MP_VALIDATION', status: 400, message: '请填写封禁原因（200 字以内）',
      })
      expect(tx.mpWork.update).not.toHaveBeenCalled()
    }
    const seed: Seed = { releases: {}, works: { m1: work() } }
    installDb(seed)
    await banWork('m1', '长'.repeat(200), 'admin1')
    expect(seed.works.m1.status).toBe('banned')
  })

  it('unbans to offline and clears the reason', async () => {
    const seed: Seed = { releases: {}, works: { m1: work({ status: 'banned', bannedReason: '违规内容' }) } }
    installDb(seed)
    await unbanWork('m1')
    expect(seed.works.m1).toMatchObject({ status: 'offline', bannedReason: null })
    expect(redisMock.incr).toHaveBeenCalledWith('mp:cache:ver')
  })

  it('refuses to unban works that are not banned', async () => {
    for (const status of ['draft', 'scheduled', 'live', 'offline']) {
      installDb({ releases: {}, works: { m1: work({ status }) } })
      await expect(unbanWork('m1')).rejects.toMatchObject(invalidState)
    }
  })

  it('returns NOT_FOUND for a missing work', async () => {
    installDb({ releases: {}, works: {} })
    await expect(banWork('m1', '违规内容', 'admin1')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(unbanWork('m1')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })
})
