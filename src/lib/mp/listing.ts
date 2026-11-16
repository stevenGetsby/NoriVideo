import { prisma } from '@/lib/prisma'
import { extractStorageKey } from '@/lib/storage'
import { MP_TAGS } from './constants'
import { MpApiError } from './errors'
import { newSlug } from './ids'

export interface ListingValue {
  title: string
  tagline: string
  synopsis: string
  tags: string[]
  creatorName: string
  coverKey: string | null
  shareCoverKey: string | null
  trailerEnabled: boolean
  reservable: boolean
  scheduleMode: 'now' | 'at'
  scheduledAt: Date | null
}

export interface MpWorkDraft {
  slug: string
  status: string
  title: string
  tagline: string
  synopsis: string
  tags: string[]
  creatorName: string
  coverKey: string | null
  shareCoverKey: string | null
  trailerEnabled: boolean
  reservable: boolean
  scheduleMode: 'now' | 'at'
  scheduledAt: string | null
  firstLiveAt: string | null
  bannedReason: string | null
}

const charCount = (value: string) => [...value].length

export const LISTING_MESSAGES = {
  title: '请填写作品名（20 字以内）',
  tagline: '请填写一句话简介（30 字以内）',
  synopsis: '详细介绍需要 10–300 字',
  tags: '请选择 1–3 个题材标签',
  creatorName: '请填写出品署名（12 字以内）',
  cover: '请上传有效的封面图片',
  scheduledAt: '上线时间需要在 1 小时后到 60 天内',
} as const

/** Field → message; empty object means the listing passes. Shared by PATCH validation and preflight. */
export function validateListing(value: ListingValue, now: Date = new Date()): Record<string, string> {
  const fields: Record<string, string> = {}
  const title = value.title.trim()
  if (!title || charCount(title) > 20) fields.title = LISTING_MESSAGES.title
  const tagline = value.tagline.trim()
  if (!tagline || charCount(tagline) > 30) fields.tagline = LISTING_MESSAGES.tagline
  const synopsis = value.synopsis.trim()
  if (charCount(synopsis) < 10 || charCount(synopsis) > 300) fields.synopsis = LISTING_MESSAGES.synopsis
  if (!Array.isArray(value.tags) || value.tags.length < 1 || value.tags.length > 3 || value.tags.some((tag) => !(MP_TAGS as readonly string[]).includes(tag))) {
    fields.tags = LISTING_MESSAGES.tags
  }
  const creatorName = value.creatorName.trim()
  if (!creatorName || charCount(creatorName) > 12) fields.creatorName = LISTING_MESSAGES.creatorName
  for (const key of ['coverKey', 'shareCoverKey'] as const) {
    const raw = value[key]
    if (raw && !extractStorageKey(raw)) fields[key] = LISTING_MESSAGES.cover
  }
  if (value.scheduleMode === 'at') {
    const at = value.scheduledAt?.getTime() ?? NaN
    const min = now.getTime() + 3600_000
    const max = now.getTime() + 60 * 24 * 3600_000
    if (!Number.isFinite(at) || at < min || at > max) fields.scheduledAt = LISTING_MESSAGES.scheduledAt
  }
  return fields
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : undefined
}

function readCoverKey(input: Record<string, unknown>, key: string): string | null | undefined {
  const value = input[key]
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  return extractStorageKey(value.trim()) ?? value.trim()
}

export function parseListingInput(input: unknown): Partial<ListingValue> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const raw = input as Record<string, unknown>
  const patch: Partial<ListingValue> = {}
  const title = readString(raw, 'title')
  if (title !== undefined) patch.title = title
  const tagline = readString(raw, 'tagline')
  if (tagline !== undefined) patch.tagline = tagline
  const synopsis = readString(raw, 'synopsis')
  if (synopsis !== undefined) patch.synopsis = synopsis
  if (Array.isArray(raw.tags)) patch.tags = raw.tags.filter((tag): tag is string => typeof tag === 'string')
  const creatorName = readString(raw, 'creatorName')
  if (creatorName !== undefined) patch.creatorName = creatorName
  const coverKey = readCoverKey(raw, 'coverKey')
  if (coverKey !== undefined) patch.coverKey = coverKey
  const shareCoverKey = readCoverKey(raw, 'shareCoverKey')
  if (shareCoverKey !== undefined) patch.shareCoverKey = shareCoverKey
  if (typeof raw.trailerEnabled === 'boolean') patch.trailerEnabled = raw.trailerEnabled
  if (typeof raw.reservable === 'boolean') patch.reservable = raw.reservable
  if (raw.scheduleMode === 'now' || raw.scheduleMode === 'at') {
    patch.scheduleMode = raw.scheduleMode
    if (raw.scheduleMode === 'now') patch.scheduledAt = null
    else if (typeof raw.scheduledAt === 'string') {
      const at = new Date(raw.scheduledAt)
      patch.scheduledAt = Number.isFinite(at.getTime()) ? at : null
    }
  }
  return patch
}

type MpWorkRow = {
  slug: string; status: string; title: string; tagline: string; synopsis: string; tags: unknown
  creatorName: string; coverKey: string | null; shareCoverKey: string | null
  trailerEnabled: boolean; reservable: boolean; scheduledAt: Date | null
  firstLiveAt: Date | null; bannedReason: string | null
}

function toDraft(row: MpWorkRow): MpWorkDraft {
  return {
    slug: row.slug,
    status: row.status,
    title: row.title,
    tagline: row.tagline,
    synopsis: row.synopsis,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    creatorName: row.creatorName,
    coverKey: row.coverKey,
    shareCoverKey: row.shareCoverKey,
    trailerEnabled: row.trailerEnabled,
    reservable: row.reservable,
    scheduleMode: row.scheduledAt ? 'at' : 'now',
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    firstLiveAt: row.firstLiveAt?.toISOString() ?? null,
    bannedReason: row.bannedReason,
  }
}

export async function readListing(workId: string): Promise<MpWorkDraft | null> {
  const row = await prisma.mpWork.findUnique({ where: { workId } })
  return row ? toDraft(row) : null
}

function valueOf(row: MpWorkRow | null, patch: Partial<ListingValue>): ListingValue {
  const base: ListingValue = row
    ? {
      title: row.title, tagline: row.tagline, synopsis: row.synopsis,
      tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      creatorName: row.creatorName, coverKey: row.coverKey, shareCoverKey: row.shareCoverKey,
      trailerEnabled: row.trailerEnabled, reservable: row.reservable,
      scheduleMode: row.scheduledAt ? 'at' : 'now', scheduledAt: row.scheduledAt,
    }
    : {
      title: '', tagline: '', synopsis: '', tags: [], creatorName: '',
      coverKey: null, shareCoverKey: null, trailerEnabled: true, reservable: true,
      scheduleMode: 'now', scheduledAt: null,
    }
  return { ...base, ...patch }
}

/** Saves the draft only; the live release meta is never touched (B.3). */
export async function saveListing(workId: string, input: unknown): Promise<MpWorkDraft> {
  const existing = await prisma.mpWork.findUnique({ where: { workId } })
  const value = valueOf(existing, parseListingInput(input))
  const fields = validateListing(value)
  if (Object.keys(fields).length) throw new MpApiError('MP_VALIDATION', { fields })
  const data = {
    title: value.title.trim(),
    tagline: value.tagline.trim(),
    synopsis: value.synopsis.trim(),
    tags: value.tags,
    creatorName: value.creatorName.trim(),
    coverKey: value.coverKey,
    shareCoverKey: value.shareCoverKey,
    trailerEnabled: value.trailerEnabled,
    reservable: value.reservable,
    scheduledAt: value.scheduleMode === 'at' ? value.scheduledAt : null,
  }
  const row = existing
    ? await prisma.mpWork.update({ where: { workId }, data })
    : await prisma.mpWork.create({ data: { workId, slug: newSlug(), ...data } })
  return toDraft(row)
}
