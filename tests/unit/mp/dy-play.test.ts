import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  dyApp: { findUnique: vi.fn() },
  storyRelease: { findUnique: vi.fn() },
  mpWork: { findUnique: vi.fn(), update: vi.fn() },
  consumerSave: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}))
const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), keys: vi.fn() }))
const signMediaEntry = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))
vi.mock('@/lib/mp/catalog', () => ({ signMediaEntry }))
vi.mock('@/lib/storage/cdn', () => ({
  mpMediaUrl: vi.fn(async (key: string) => `https://cdn.test/${key}`),
  MP_URL_BUCKET_SEC: 6 * 3600,
  MP_URL_TTL_SEC: 12 * 3600,
}))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn(), child: vi.fn() }),
}))

import { dyPlayManifest } from '@/lib/mp/dy/play'

const APP_ROW = { id: 'a1', appId: 'ttTest0000000000', mpWorkId: 'mpw1', name: '测试', status: 'active', releaseIds: ['r1'], secretEnc: 'enc' }
const RELEASE_ROW = {
  id: 'r1', workId: 'w1', version: 2, aspectRatio: '9:16', status: 'live',
  programKey: 'mp/releases/r1/program.json', programHash: 'hash-r1',
  manifest: { pipelineVersion: 1, media: { m1: { id: 'm1', kind: 'video', w: 720, h: 1280, durationSec: 6, files: { v720: 'mp/releases/r1/m1/v720.mp4' }, refs: [], source: 's', bytes: 1 } } },
  meta: { title: '测试剧', chapters: [], endings: [], achievements: [] },
}
const WORK_ROW = { id: 'mpw1', workId: 'w1', status: 'live' }

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.get.mockResolvedValue(null)
  redisMock.set.mockResolvedValue('OK')
  redisMock.del.mockResolvedValue(0)
  redisMock.keys.mockResolvedValue([])
  prismaMock.dyApp.findUnique.mockResolvedValue({ ...APP_ROW })
  prismaMock.storyRelease.findUnique.mockResolvedValue({ ...RELEASE_ROW })
  prismaMock.mpWork.findUnique.mockResolvedValue({ ...WORK_ROW })
  signMediaEntry.mockImplementation(async (entry: { kind: string; w: number; h: number }) => ({ kind: entry.kind, w: entry.w, h: entry.h }))
})

describe('dyPlayManifest（N7）', () => {
  it('releaseId 不在白名单 → MP_NOT_PLAYABLE', async () => {
    await expect(dyPlayManifest(APP_ROW.appId, 'rX')).rejects.toMatchObject({ code: 'MP_NOT_PLAYABLE' })
  })

  it('app offline → MP_NOT_PLAYABLE', async () => {
    prismaMock.dyApp.findUnique.mockResolvedValue({ ...APP_ROW, status: 'offline' })
    await expect(dyPlayManifest(APP_ROW.appId, 'r1')).rejects.toMatchObject({ code: 'MP_NOT_PLAYABLE' })
  })

  it('作品被封禁 → MP_NOT_PLAYABLE', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue({ ...WORK_ROW, status: 'banned' })
    await expect(dyPlayManifest(APP_ROW.appId, 'r1')).rejects.toMatchObject({ code: 'MP_NOT_PLAYABLE' })
  })

  it('release 不属于该作品 → MP_NOT_PLAYABLE', async () => {
    prismaMock.storyRelease.findUnique.mockResolvedValue({ ...RELEASE_ROW, workId: 'other-work' })
    await expect(dyPlayManifest(APP_ROW.appId, 'r1')).rejects.toMatchObject({ code: 'MP_NOT_PLAYABLE' })
  })

  it('产物缺失或状态不可玩 → MP_NOT_PLAYABLE', async () => {
    prismaMock.storyRelease.findUnique.mockResolvedValue({ ...RELEASE_ROW, programHash: null })
    await expect(dyPlayManifest(APP_ROW.appId, 'r1')).rejects.toMatchObject({ code: 'MP_NOT_PLAYABLE' })
    prismaMock.storyRelease.findUnique.mockResolvedValue({ ...RELEASE_ROW, status: 'reviewing' })
    await expect(dyPlayManifest(APP_ROW.appId, 'r1')).rejects.toMatchObject({ code: 'MP_NOT_PLAYABLE' })
    prismaMock.storyRelease.findUnique.mockResolvedValue(null)
    await expect(dyPlayManifest(APP_ROW.appId, 'r1')).rejects.toMatchObject({ code: 'MP_NOT_PLAYABLE' })
  })

  it('成功：签名媒体 + meta + 秒级 expiresAt，不增加 playerCount', async () => {
    const manifest = await dyPlayManifest(APP_ROW.appId, 'r1')
    expect(manifest.releaseId).toBe('r1')
    expect(manifest.programUrl).toBe('https://cdn.test/mp/releases/r1/program.json')
    expect(manifest.programHash).toBe('hash-r1')
    expect(manifest.media.m1).toMatchObject({ kind: 'video', w: 720, h: 1280 })
    expect(manifest.stats).toBe('/api/mp/releases/r1/stats')
    expect(manifest.meta.title).toBe('测试剧')
    expect(typeof manifest.expiresAt).toBe('number')
    expect(manifest.expiresAt).toBeGreaterThan(Date.now() / 1000)
    expect(prismaMock.mpWork.update).not.toHaveBeenCalled()
    expect(prismaMock.consumerSave.create).not.toHaveBeenCalled()
    expect(prismaMock.consumerSave.update).not.toHaveBeenCalled()
  })

  it('approved 和 retired 的 release 也可玩', async () => {
    for (const status of ['approved', 'retired']) {
      prismaMock.storyRelease.findUnique.mockResolvedValue({ ...RELEASE_ROW, status })
      await expect(dyPlayManifest(APP_ROW.appId, 'r1')).resolves.toMatchObject({ releaseId: 'r1' })
    }
  })
})
