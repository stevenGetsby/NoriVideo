import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'

const prismaMock = vi.hoisted(() => ({
  mpWork: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  storyRelease: { findUnique: vi.fn(), findMany: vi.fn() },
  mpFeatureSlot: { findMany: vi.fn() },
  mpTopic: { findMany: vi.fn(), findFirst: vi.fn() },
  consumerSave: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  consumerFavorite: { findUnique: vi.fn() },
  consumerRating: { findUnique: vi.fn() },
  mpReservation: { findUnique: vi.fn() },
  consumerUser: { findUnique: vi.fn(), create: vi.fn() },
}))
const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), eval: vi.fn() }))
const storageMock = vi.hoisted(() => ({ getSignedObjectUrl: vi.fn() }))
const wxMock = vi.hoisted(() => ({ code2Session: vi.fn(), msgSecCheck: vi.fn(), getAccessToken: vi.fn() }))
const sessionMock = vi.hoisted(() => ({ getServerSession: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redis', () => ({ redis: redisMock }))
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/mp/wx', () => wxMock)
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn(), child: vi.fn() }),
}))
vi.mock('next-auth/next', () => ({ getServerSession: sessionMock.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/test-mode', () => ({ isTestModeEnabled: () => false, getOrCreateTestModeSession: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined, getAll: () => [], has: () => false })),
}))

import { GET as homeGET } from '@/app/api/mp/home/route'
import { GET as worksGET } from '@/app/api/mp/works/route'
import { GET as rankingGET } from '@/app/api/mp/rankings/[kind]/route'
import { GET as searchGET } from '@/app/api/mp/search/route'
import { GET as topicGET } from '@/app/api/mp/topics/[slug]/route'
import { GET as detailGET } from '@/app/api/mp/works/[slug]/route'
import { GET as playGET } from '@/app/api/mp/works/[slug]/play/route'
import { GET as meGET } from '@/app/api/mp/me/route'
import { POST as loginPOST } from '@/app/api/mp/auth/login/route'
import { GET as interactiveGET } from '@/app/api/interactive/route'
import { signConsumerToken } from '@/lib/mp/token'

const CONSUMER = { id: 'c1', openid: 'openid-abcdef', nickname: '观众abc', avatarIndex: 0, status: 'active', tokenVersion: 0 }
const INTERNAL_WORK_ID = 'internal-work-id-xyz'
const INTERNAL_CREATOR_ID = 'creator-internal-id'
const REVIEW_NOTE = '内部审核备注'

const META = {
  title: '迷雾之城', tagline: '一夜之间', synopsis: '一段简介', tags: ['悬疑'],
  creatorName: '蓝喵工作室', accentColor: '#3366ff',
  cover: 'mp/releases/r1/cover.jpg', shareCover: 'mp/releases/r1/share.jpg',
  trailer: 'mp/releases/r1/trailer.mp4', trailerPoster: 'mp/releases/r1/poster.jpg',
  chapters: [{ projectId: 'p1', order: 1, title: '第一章', durationSec: 60 }],
  endings: [{ projectId: 'p1', nodeId: 'e1', title: '真相大白', endingType: 'good', chapterOrder: 1 }],
  achievements: [
    { id: 'a1', name: '初见', description: '第一次抵达', icon: 'mp:bbbbbbbbbbbbbbbb' },
    { id: 'a2', name: '彩蛋', description: '发现彩蛋', icon: '🎬' },
  ],
  segmentCount: 3,
  texts: [{ where: '/chapters/0/nodes/0/text', text: '审核用文本' }],
}

const MANIFEST = {
  pipelineVersion: 1,
  media: {
    aaaaaaaaaaaaaaaa: {
      id: 'aaaaaaaaaaaaaaaa', kind: 'video', source: 'videos/src-a.mp4', w: 720, h: 1280, durationSec: 60, bytes: 1000,
      files: {
        v720: 'mp/releases/r1/m/aaaaaaaaaaaaaaaa/720.mp4', v480: 'mp/releases/r1/m/aaaaaaaaaaaaaaaa/480.mp4',
        poster: 'mp/releases/r1/m/aaaaaaaaaaaaaaaa/poster.jpg', last: 'mp/releases/r1/m/aaaaaaaaaaaaaaaa/last.jpg',
        sheet: 'mp/releases/r1/m/aaaaaaaaaaaaaaaa/sheet.jpg',
      },
      refs: ['/chapters/0/nodes/0/media/url'],
    },
    bbbbbbbbbbbbbbbb: {
      id: 'bbbbbbbbbbbbbbbb', kind: 'image', source: 'images/src-b.jpg', w: 720, h: 960, bytes: 500,
      files: { img: 'mp/releases/r1/m/bbbbbbbbbbbbbbbb/img.jpg' }, refs: [],
    },
  },
}

const RELEASE = {
  id: 'r1', workId: INTERNAL_WORK_ID, version: 3, status: 'live', aspectRatio: '9:16',
  chapterCount: 1, endingCount: 1, totalDurationSec: 60,
  programKey: 'mp/releases/r1/program.json', programHash: 'hash-r1',
  meta: META, manifest: MANIFEST, createdById: INTERNAL_CREATOR_ID, reviewNote: REVIEW_NOTE,
}

const WORK = {
  id: 'mpw1', workId: INTERNAL_WORK_ID, slug: 'abcd1234', status: 'live',
  scheduledAt: null, liveReleaseId: 'r1', pendingReleaseId: null, firstLiveAt: new Date('2026-11-01T00:00:00Z'),
  playerCount: 12, reserveCount: 0, ratingCount: 25, ratingScore: 4.4,
}
const SCHEDULED_WORK = { ...WORK, id: 'mpw2', slug: 'soon5678', status: 'scheduled', liveReleaseId: null, pendingReleaseId: 'r1', scheduledAt: new Date('2026-12-01T00:00:00Z'), reserveCount: 7 }
const TOPIC = { id: 't1', slug: 'topic001', title: '悬疑专题', subtitle: '烧脑', description: '专题描述', coverKey: 'mp/topics/t1/cover.jpg', mpWorkIds: ['mpw1'], status: 'live', startsAt: null, endsAt: null, sort: 0 }
const SAVE = { mpWorkId: 'mpw1', progress: 0.5, endingsGot: 1, lastPlayedAt: new Date('2026-11-10T00:00:00Z'), profile: { endings: [], segments: [], achievements: ['a1'], bought: [], equipped: { title: null, frame: null } } }

const FORBIDDEN_KEYS = new Set(['workId', 'workspaceOwnerId', 'createdById', 'storageKey', 'reviewNote', 'openid', 'unionid'])
const BARE_KEY = /^(images|videos|mp\/releases)\//

function assertNoLeak(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoLeak(item, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      expect(FORBIDDEN_KEYS.has(key), `forbidden key "${key}" at ${path}`).toBe(false)
      assertNoLeak(child, `${path}.${key}`)
    }
    return
  }
  if (typeof value === 'string') {
    expect(BARE_KEY.test(value), `bare storage key at ${path}: ${value}`).toBe(false)
  }
}

const SECRET_VALUES = [INTERNAL_WORK_ID, INTERNAL_CREATOR_ID, REVIEW_NOTE, 'openid-abcdef', 'videos/src-a.mp4', 'images/src-b.jpg', 'sheet.jpg', '/chapters/0/nodes/0/media/url', '审核用文本']

async function leakCheck(response: Response): Promise<Record<string, unknown>> {
  expect(response.status).toBe(200)
  const body = await response.json() as Record<string, unknown>
  assertNoLeak(body)
  const serialized = JSON.stringify(body)
  for (const secret of SECRET_VALUES) expect(serialized.includes(secret), `leaked "${secret}"`).toBe(false)
  return body
}

let token = ''
const ENV_KEYS = ['MP_JWT_SECRET', 'MEDIA_CDN_BASE_URL', 'MEDIA_CDN_AUTH_KEY', 'MEDIA_CDN_AUTH_PARAM', 'MP_ALLOW_TOS_DIRECT'] as const
let savedEnv: Record<string, string | undefined> = {}

function authed(path: string, query?: Record<string, string>) {
  return buildMockRequest({ path, method: 'GET', headers: { authorization: `Bearer ${token}` }, query })
}
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) })

beforeEach(() => {
  vi.clearAllMocks()
  savedEnv = {}
  for (const name of ENV_KEYS) { savedEnv[name] = process.env[name]; delete process.env[name] }
  process.env.MP_JWT_SECRET = 'contract-secret'
  process.env.MEDIA_CDN_BASE_URL = 'https://media.example.com'
  process.env.MEDIA_CDN_AUTH_KEY = 'contract-key'
  token = signConsumerToken('c1', 0).token

  redisMock.get.mockResolvedValue(null)
  redisMock.set.mockResolvedValue('OK')
  redisMock.del.mockResolvedValue(1)
  redisMock.incr.mockResolvedValue(1)
  redisMock.eval.mockResolvedValue([0, 29, 0])
  storageMock.getSignedObjectUrl.mockResolvedValue('https://tos.example/signed')
  wxMock.code2Session.mockResolvedValue({ openid: 'openid-abcdef', unionid: null })

  prismaMock.consumerUser.findUnique.mockResolvedValue({ ...CONSUMER })
  prismaMock.consumerUser.create.mockResolvedValue({ ...CONSUMER })
  prismaMock.mpWork.findUnique.mockResolvedValue({ id: 'mpw1' })
  prismaMock.mpWork.findFirst.mockResolvedValue({ ...WORK })
  prismaMock.mpWork.findMany.mockImplementation(async (args: { where?: { status?: string } }) =>
    args?.where?.status === 'scheduled' ? [{ ...SCHEDULED_WORK }] : [{ ...WORK }])
  prismaMock.storyRelease.findUnique.mockResolvedValue({ ...RELEASE })
  prismaMock.storyRelease.findMany.mockResolvedValue([{ id: 'r1', meta: META }])
  prismaMock.mpFeatureSlot.findMany.mockResolvedValue([])
  prismaMock.mpTopic.findMany.mockResolvedValue([{ ...TOPIC }])
  prismaMock.mpTopic.findFirst.mockResolvedValue({ ...TOPIC })
  prismaMock.consumerSave.findMany.mockResolvedValue([{ ...SAVE }])
  prismaMock.consumerSave.findUnique.mockResolvedValue({ id: 's1', profile: SAVE.profile, progress: 0.5 })
  prismaMock.consumerSave.update.mockResolvedValue({ id: 's1' })
  prismaMock.consumerFavorite.findUnique.mockResolvedValue({ id: 'f1' })
  prismaMock.consumerRating.findUnique.mockResolvedValue({ score: 5 })
  prismaMock.mpReservation.findUnique.mockResolvedValue(null)
  sessionMock.getServerSession.mockResolvedValue(null)
})

afterEach(() => {
  for (const name of ENV_KEYS) {
    if (savedEnv[name] === undefined) delete process.env[name]
    else process.env[name] = savedEnv[name]
  }
})

describe('C-side response leak guard (红线 2)', () => {
  it('home signs every URL and never exposes internal ids or bare keys', async () => {
    const body = await leakCheck(await homeGET(authed('/api/mp/home'), ctx({})))
    expect((body.hot as unknown[]).length).toBe(1)
    expect((body.continue as unknown[]).length).toBe(1)
    expect((body.topics as { cover: string }[])[0].cover.startsWith('https://media.example.com/')).toBe(true)
  })

  it('works list returns signed covers and an opaque cursor', async () => {
    const body = await leakCheck(await worksGET(buildMockRequest({ path: '/api/mp/works', method: 'GET', query: { sort: 'hot', limit: '1' } }), ctx({})))
    const items = body.items as { cover: string; slug: string }[]
    expect(items[0].cover.startsWith('https://media.example.com/mp/releases/r1/cover.jpg?auth_key=')).toBe(true)
    expect(typeof body.nextCursor).toBe('string')
  })

  it('rankings expose only public card fields', async () => {
    await leakCheck(await rankingGET(buildMockRequest({ path: '/api/mp/rankings/hot', method: 'GET' }), ctx({ kind: 'hot' })))
  })

  it('search exposes only public card fields', async () => {
    await leakCheck(await searchGET(buildMockRequest({ path: '/api/mp/search', method: 'GET', query: { q: '迷雾' } }), ctx({})))
  })

  it('topic detail signs cover and item covers', async () => {
    const body = await leakCheck(await topicGET(buildMockRequest({ path: '/api/mp/topics/topic001', method: 'GET' }), ctx({ slug: 'topic001' })))
    expect((body.topic as { cover: string }).cover.startsWith('https://media.example.com/')).toBe(true)
  })

  it('work detail hides uncollected ending titles and resolves achievement icons', async () => {
    const body = await leakCheck(await detailGET(authed('/api/mp/works/abcd1234'), ctx({ slug: 'abcd1234' })))
    const work = body.work as { releaseId: string; shareCover: string; trailer: { url: string } | null }
    expect(work.releaseId).toBe('r1')
    expect(work.shareCover.startsWith('https://media.example.com/')).toBe(true)
    expect(work.trailer?.url.startsWith('https://media.example.com/')).toBe(true)
    expect((body.endings as { title: string | null }[])[0].title).toBeNull()
    const achievements = body.achievements as { id: string; icon: string | null }[]
    expect(achievements.find((a) => a.id === 'a1')?.icon?.startsWith('https://media.example.com/')).toBe(true)
    expect(achievements.find((a) => a.id === 'a2')?.icon).toBe('🎬')
    expect((body.viewer as { favorited: boolean; rating: number }).favorited).toBe(true)
  })

  it('play manifest signs media but strips source, sheet and refs', async () => {
    const body = await leakCheck(await playGET(authed('/api/mp/works/abcd1234/play'), ctx({ slug: 'abcd1234' })))
    expect(body.programUrl).toMatch(/^https:\/\/media\.example\.com\/mp\/releases\/r1\/program\.json\?auth_key=/)
    expect(body.stats).toBe('/api/mp/releases/r1/stats')
    const video = (body.media as Record<string, { v720?: string; source?: string; sheet?: string }>).aaaaaaaaaaaaaaaa
    expect(video.v720?.startsWith('https://media.example.com/')).toBe(true)
    expect(video.source).toBeUndefined()
    expect(video.sheet).toBeUndefined()
  })

  it('me exposes only id, nickname, avatarIndex and aggregate stats', async () => {
    const body = await leakCheck(await meGET(authed('/api/mp/me'), ctx({})))
    expect(Object.keys(body).sort()).toEqual(['avatarIndex', 'id', 'nickname', 'stats'])
  })

  it('login never returns openid, unionid or session_key', async () => {
    wxMock.code2Session.mockResolvedValue({ openid: 'openid-abcdef', unionid: 'unionid-secret' })
    prismaMock.consumerUser.findUnique.mockResolvedValue(null)
    const response = await loginPOST(buildMockRequest({ path: '/api/mp/auth/login', method: 'POST', body: { code: 'wx-code', launch: { scene: 1001 } } }), ctx({}))
    const body = await leakCheck(response)
    expect(JSON.stringify(body).includes('unionid-secret')).toBe(false)
    expect((body.user as { id: string }).id).toBe('c1')
    expect(typeof body.token).toBe('string')
  })
})

describe('auth isolation (R4)', () => {
  it('rejects a next-auth cookie without a Bearer token on /api/mp/me with 401', async () => {
    const response = await meGET(buildMockRequest({ path: '/api/mp/me', method: 'GET', headers: { cookie: 'next-auth.session-token=b-side-session' } }), ctx({}))
    expect(response.status).toBe(401)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('MP_UNAUTHORIZED')
  })

  it('rejects a C-side token on a B-side route with 401', async () => {
    const response = await interactiveGET(buildMockRequest({
      path: '/api/interactive', method: 'GET',
      headers: { authorization: `Bearer ${token}`, cookie: 'next-auth.session-token=b-side-session' },
    }), ctx({}))
    expect(response.status).toBe(401)
    expect(sessionMock.getServerSession).toHaveBeenCalled()
  })
})
