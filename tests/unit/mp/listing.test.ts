import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/storage', () => ({
  extractStorageKey: (input: string | null | undefined) => {
    if (!input) return null
    if (input.startsWith('/api/files/')) return decodeURIComponent(input.slice('/api/files/'.length))
    if (!input.startsWith('http') && !input.startsWith('/')) return input
    try {
      return new URL(input).pathname.replace(/^\/+/, '') || null
    } catch {
      return null
    }
  },
}))

const prismaMock = vi.hoisted(() => ({
  mpWork: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  storyRelease: { update: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { MpApiError } from '@/lib/mp/errors'
import {
  LISTING_MESSAGES,
  parseListingInput,
  readListing,
  saveListing,
  validateListing,
  type ListingValue,
} from '@/lib/mp/listing'

const NOW = new Date('2026-11-16T00:00:00.000Z')
const SYNOPSIS = '这是一个足够长的详细介绍内容'

function validValue(overrides: Partial<ListingValue> = {}): ListingValue {
  return {
    title: '雨夜',
    tagline: '一句话勾住观众',
    synopsis: SYNOPSIS,
    tags: ['悬疑'],
    creatorName: '蓝喵工作室',
    coverKey: 'images/cover.jpg',
    shareCoverKey: null,
    trailerEnabled: true,
    reservable: true,
    scheduleMode: 'now',
    scheduledAt: null,
    ...overrides,
  }
}

function workRow(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'Ab12Cd34',
    status: 'draft',
    title: '雨夜',
    tagline: '一句话勾住观众',
    synopsis: SYNOPSIS,
    tags: ['悬疑'],
    creatorName: '蓝喵工作室',
    coverKey: 'images/cover.jpg',
    shareCoverKey: null,
    trailerEnabled: true,
    reservable: true,
    scheduledAt: null,
    firstLiveAt: null,
    bannedReason: null,
    ...overrides,
  }
}

const validInput = {
  title: '雨夜',
  tagline: '一句话勾住观众',
  synopsis: SYNOPSIS,
  tags: ['悬疑'],
  creatorName: '蓝喵工作室',
  coverKey: 'images/cover.jpg',
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.mpWork.findUnique.mockResolvedValue(null)
})

describe('validateListing', () => {
  it('accepts a complete listing', () => {
    expect(validateListing(validValue(), NOW)).toEqual({})
  })

  it('validates title length by codepoints', () => {
    expect(validateListing(validValue({ title: '' }), NOW).title).toBe(LISTING_MESSAGES.title)
    expect(validateListing(validValue({ title: '   ' }), NOW).title).toBe(LISTING_MESSAGES.title)
    expect(validateListing(validValue({ title: '雨'.repeat(21) }), NOW).title).toBe(LISTING_MESSAGES.title)
    expect(validateListing(validValue({ title: '雨'.repeat(20) }), NOW).title).toBeUndefined()
    expect(validateListing(validValue({ title: '🌧'.repeat(20) }), NOW).title).toBeUndefined()
    expect(validateListing(validValue({ title: '🌧'.repeat(21) }), NOW).title).toBe(LISTING_MESSAGES.title)
  })

  it('validates tagline length', () => {
    expect(validateListing(validValue({ tagline: '' }), NOW).tagline).toBe(LISTING_MESSAGES.tagline)
    expect(validateListing(validValue({ tagline: '简'.repeat(31) }), NOW).tagline).toBe(LISTING_MESSAGES.tagline)
    expect(validateListing(validValue({ tagline: '简'.repeat(30) }), NOW).tagline).toBeUndefined()
  })

  it('validates synopsis between 10 and 300 codepoints', () => {
    expect(validateListing(validValue({ synopsis: '短'.repeat(9) }), NOW).synopsis).toBe(LISTING_MESSAGES.synopsis)
    expect(validateListing(validValue({ synopsis: '长'.repeat(301) }), NOW).synopsis).toBe(LISTING_MESSAGES.synopsis)
    expect(validateListing(validValue({ synopsis: '短'.repeat(10) }), NOW).synopsis).toBeUndefined()
    expect(validateListing(validValue({ synopsis: '长'.repeat(300) }), NOW).synopsis).toBeUndefined()
  })

  it('only accepts 1–3 tags from MP_TAGS', () => {
    expect(validateListing(validValue({ tags: [] }), NOW).tags).toBe(LISTING_MESSAGES.tags)
    expect(validateListing(validValue({ tags: ['悬疑', '恋爱', '奇幻', '科幻'] }), NOW).tags).toBe(LISTING_MESSAGES.tags)
    expect(validateListing(validValue({ tags: ['不存在的标签'] }), NOW).tags).toBe(LISTING_MESSAGES.tags)
    expect(validateListing(validValue({ tags: ['悬疑', '恋爱', '奇幻'] }), NOW).tags).toBeUndefined()
  })

  it('validates creatorName length', () => {
    expect(validateListing(validValue({ creatorName: '' }), NOW).creatorName).toBe(LISTING_MESSAGES.creatorName)
    expect(validateListing(validValue({ creatorName: '名'.repeat(13) }), NOW).creatorName).toBe(LISTING_MESSAGES.creatorName)
    expect(validateListing(validValue({ creatorName: '名'.repeat(12) }), NOW).creatorName).toBeUndefined()
  })

  it('rejects cover keys that are not storage references', () => {
    expect(validateListing(validValue({ coverKey: 'http://' }), NOW).coverKey).toBe(LISTING_MESSAGES.cover)
    expect(validateListing(validValue({ shareCoverKey: 'http://' }), NOW).shareCoverKey).toBe(LISTING_MESSAGES.cover)
    expect(validateListing(validValue({ coverKey: 'images/cover.jpg' }), NOW).coverKey).toBeUndefined()
    expect(validateListing(validValue({ coverKey: 'https://cdn.example.com/images/cover.jpg' }), NOW).coverKey).toBeUndefined()
    expect(validateListing(validValue({ coverKey: null }), NOW).coverKey).toBeUndefined()
  })

  it('requires scheduledAt between 1 hour and 60 days ahead', () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms)
    expect(validateListing(validValue({ scheduleMode: 'at', scheduledAt: null }), NOW).scheduledAt).toBe(LISTING_MESSAGES.scheduledAt)
    expect(validateListing(validValue({ scheduleMode: 'at', scheduledAt: at(30 * 60_000) }), NOW).scheduledAt).toBe(LISTING_MESSAGES.scheduledAt)
    expect(validateListing(validValue({ scheduleMode: 'at', scheduledAt: at(60 * 24 * 3600_000 + 1) }), NOW).scheduledAt).toBe(LISTING_MESSAGES.scheduledAt)
    expect(validateListing(validValue({ scheduleMode: 'at', scheduledAt: at(3600_000) }), NOW).scheduledAt).toBeUndefined()
    expect(validateListing(validValue({ scheduleMode: 'at', scheduledAt: at(60 * 24 * 3600_000) }), NOW).scheduledAt).toBeUndefined()
    expect(validateListing(validValue({ scheduleMode: 'now', scheduledAt: null }), NOW).scheduledAt).toBeUndefined()
  })
})

describe('parseListingInput', () => {
  it('ignores non-object input and wrong field types', () => {
    expect(parseListingInput(null)).toEqual({})
    expect(parseListingInput([1, 2])).toEqual({})
    expect(parseListingInput({ title: 123, tagline: true, synopsis: {}, creatorName: 0, trailerEnabled: 'yes', reservable: 1 })).toEqual({})
  })

  it('trims strings and filters tags to strings', () => {
    expect(parseListingInput({ title: '  雨夜  ', tags: ['悬疑', 5, null, '恋爱'] })).toEqual({ title: '雨夜', tags: ['悬疑', '恋爱'] })
  })

  it('normalizes cover keys and clears them on empty input', () => {
    expect(parseListingInput({ coverKey: '' })).toEqual({ coverKey: null })
    expect(parseListingInput({ coverKey: null })).toEqual({ coverKey: null })
    expect(parseListingInput({ coverKey: 'https://cdn.example.com/images/cover.jpg' })).toEqual({ coverKey: 'images/cover.jpg' })
    expect(parseListingInput({ shareCoverKey: '/api/files/images%2Fshare.jpg' })).toEqual({ shareCoverKey: 'images/share.jpg' })
  })

  it('parses schedule modes', () => {
    expect(parseListingInput({ scheduleMode: 'now', scheduledAt: '2026-12-01T00:00:00.000Z' })).toEqual({ scheduleMode: 'now', scheduledAt: null })
    const at = parseListingInput({ scheduleMode: 'at', scheduledAt: '2026-12-01T00:00:00.000Z' })
    expect(at.scheduleMode).toBe('at')
    expect(at.scheduledAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(parseListingInput({ scheduleMode: 'at', scheduledAt: 'not-a-date' })).toEqual({ scheduleMode: 'at', scheduledAt: null })
    expect(parseListingInput({ scheduleMode: 'later' })).toEqual({})
  })
})

describe('readListing', () => {
  it('returns null without a row', async () => {
    expect(await readListing('w1')).toBeNull()
  })

  it('maps a row to a draft with ISO dates and derived schedule mode', async () => {
    const scheduledAt = new Date('2026-12-01T00:00:00.000Z')
    prismaMock.mpWork.findUnique.mockResolvedValue(workRow({ status: 'scheduled', scheduledAt, firstLiveAt: null }))
    const draft = await readListing('w1')
    expect(draft).toMatchObject({
      slug: 'Ab12Cd34',
      status: 'scheduled',
      scheduleMode: 'at',
      scheduledAt: '2026-12-01T00:00:00.000Z',
      firstLiveAt: null,
      bannedReason: null,
    })
  })
})

describe('saveListing', () => {
  it('creates the MpWork row with a fresh 8-char base62 slug on first save', async () => {
    prismaMock.mpWork.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => workRow(data))
    const draft = await saveListing('w1', validInput)
    expect(prismaMock.mpWork.create).toHaveBeenCalledTimes(1)
    const data = prismaMock.mpWork.create.mock.calls[0][0].data
    expect(data.workId).toBe('w1')
    expect(data.slug).toMatch(/^[0-9A-Za-z]{8}$/)
    expect(data.title).toBe('雨夜')
    expect(data.scheduledAt).toBeNull()
    expect(data).not.toHaveProperty('status')
    expect(data).not.toHaveProperty('liveReleaseId')
    expect(draft.slug).toBe(data.slug)
  })

  it('rejects invalid input with MP_VALIDATION and per-field messages', async () => {
    await expect(saveListing('w1', { ...validInput, title: '', tags: [] })).rejects.toMatchObject({
      name: 'MpApiError',
      code: 'MP_VALIDATION',
      status: 400,
      details: { fields: { title: LISTING_MESSAGES.title, tags: LISTING_MESSAGES.tags } },
    })
    expect(prismaMock.mpWork.create).not.toHaveBeenCalled()
    expect(prismaMock.mpWork.update).not.toHaveBeenCalled()
  })

  it('throws an MpApiError instance', async () => {
    const error = await saveListing('w1', { title: '' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MpApiError)
  })

  it('merges a partial patch over the existing row before validating', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue(workRow())
    prismaMock.mpWork.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => workRow(data))
    const draft = await saveListing('w1', { title: '  新名字  ' })
    const data = prismaMock.mpWork.update.mock.calls[0][0].data
    expect(data.title).toBe('新名字')
    expect(data.tagline).toBe('一句话勾住观众')
    expect(data.synopsis).toBe(SYNOPSIS)
    expect(draft.title).toBe('新名字')
  })

  it('updates draft fields only and never touches the live release (B.3)', async () => {
    prismaMock.mpWork.findUnique.mockResolvedValue(workRow({
      status: 'live',
      liveReleaseId: 'r1',
      firstLiveAt: new Date('2026-11-01T00:00:00.000Z'),
      playerCount: 42,
      ratingCount: 3,
    }))
    prismaMock.mpWork.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => workRow({ ...data, status: 'live' }))
    await saveListing('w1', { ...validInput, title: '雨夜·重制' })
    expect(prismaMock.mpWork.update).toHaveBeenCalledTimes(1)
    const args = prismaMock.mpWork.update.mock.calls[0][0]
    expect(args.where).toEqual({ workId: 'w1' })
    expect(Object.keys(args.data).sort()).toEqual([
      'coverKey', 'creatorName', 'reservable', 'scheduledAt', 'shareCoverKey', 'synopsis', 'tagline', 'tags', 'title', 'trailerEnabled',
    ])
    expect(prismaMock.storyRelease.update).not.toHaveBeenCalled()
  })

  it('persists scheduled mode only when scheduleMode is at', async () => {
    prismaMock.mpWork.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => workRow(data))
    await saveListing('w1', { ...validInput, scheduleMode: 'at', scheduledAt: '2026-12-01T00:00:00.000Z' })
    const data = prismaMock.mpWork.create.mock.calls[0][0].data
    expect(data.scheduledAt).toEqual(new Date('2026-12-01T00:00:00.000Z'))
  })
})
