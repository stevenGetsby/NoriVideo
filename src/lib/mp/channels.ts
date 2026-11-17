import { Prisma, type MpChannel } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { uploadObject } from '@/lib/storage'
import { mpMediaUrl } from '@/lib/storage/cdn'
import { MpApiError } from './errors'
import { newChannelCode } from './ids'
import { generateUrlLink, getUnlimitedWxacode } from './wx'

export const MP_CHANNEL_MAX_ACTIVE = 50
export const URL_LINK_TTL_DAYS = 30
const URL_LINK_RENEW_MS = 24 * 3600 * 1000
const STATS_WINDOW_MS = 30 * 24 * 3600 * 1000

export function urlLinkEnabled(): boolean {
  return process.env.MP_URL_LINK_ENABLED?.trim() === '1'
}

function isP2002(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

interface ChannelTarget { path: string; query: string; scene: string }

async function targetOf(mpWorkId: string | null, topicId: string | null, code: string): Promise<ChannelTarget> {
  if (mpWorkId) {
    const work = await prisma.mpWork.findUnique({ where: { id: mpWorkId }, select: { slug: true, status: true } })
    if (!work) throw new MpApiError('MP_VALIDATION', { message: '作品不存在' })
    if (work.status !== 'live' && work.status !== 'scheduled') throw new MpApiError('MP_INVALID_STATE', { message: '作品上线后可以生成推广渠道' })
    return { path: 'pages/work/index', query: `w=${work.slug}&c=${code}`, scene: `c=${code}&w=${work.slug}` }
  }
  if (topicId) {
    const topic = await prisma.mpTopic.findUnique({ where: { id: topicId }, select: { slug: true } })
    if (!topic) throw new MpApiError('MP_VALIDATION', { message: '专题不存在' })
    return { path: 'pages/topic/index', query: `t=${topic.slug}&c=${code}`, scene: `c=${code}&t=${topic.slug}` }
  }
  return { path: 'pages/home/index', query: `c=${code}`, scene: `c=${code}` }
}

export interface CreateChannelInput {
  kind: 'creator' | 'ops'
  name: string
  mpWorkId?: string | null
  topicId?: string | null
  userId: string
}

export async function createChannel(input: CreateChannelInput): Promise<MpChannel> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || [...name].length > 20) throw new MpApiError('MP_VALIDATION', { message: '渠道名称需要 1–20 字' })
  const mpWorkId = input.mpWorkId ?? null
  const topicId = mpWorkId ? null : (input.topicId ?? null)
  if (mpWorkId) {
    const active = await prisma.mpChannel.count({ where: { mpWorkId, archived: false } })
    if (active >= MP_CHANNEL_MAX_ACTIVE) throw new MpApiError('MP_INVALID_STATE', { message: `未归档渠道不能超过 ${MP_CHANNEL_MAX_ACTIVE} 个` })
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newChannelCode()
    const taken = await prisma.mpChannel.findUnique({ where: { code }, select: { id: true } })
    if (taken) continue
    const target = await targetOf(mpWorkId, topicId, code)
    const buffer = await getUnlimitedWxacode(target.scene, target.path)
    const wxacodeKey = `mp/wxacode/c/${code}.png`
    await uploadObject(buffer, wxacodeKey, undefined, 'image/png')
    let urlLink: string | null = null
    let urlLinkExpiresAt: Date | null = null
    if (urlLinkEnabled()) {
      urlLink = await generateUrlLink(target.path, target.query)
      urlLinkExpiresAt = new Date(Date.now() + URL_LINK_TTL_DAYS * 24 * 3600 * 1000)
    }
    try {
      return await prisma.mpChannel.create({
        data: { code, name, kind: input.kind, mpWorkId, topicId, createdByUserId: input.userId, wxacodeKey, urlLink, urlLinkExpiresAt },
      })
    } catch (error) {
      if (isP2002(error)) continue
      throw error
    }
  }
  throw new MpApiError('MP_INVALID_STATE', { message: '渠道码生成失败，请重试' })
}

export interface ChannelRow {
  id: string
  code: string
  name: string
  createdAt: string
  wxacodeUrl: string | null
  path: string
  urlLink: string | null
  urlLinkExpiresAt: string | null
  newUsers30d: number
  players30d: number
}

export async function toChannelRow(row: MpChannel, targetSlug: string | null, newUsers30d = 0, players30d = 0): Promise<ChannelRow> {
  const path = row.mpWorkId && targetSlug
    ? `pages/work/index?w=${targetSlug}&c=${row.code}`
    : row.topicId && targetSlug
      ? `pages/topic/index?t=${targetSlug}&c=${row.code}`
      : `pages/home/index?c=${row.code}`
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    wxacodeUrl: row.wxacodeKey ? await mpMediaUrl(row.wxacodeKey) : null,
    path,
    urlLink: row.urlLink,
    urlLinkExpiresAt: row.urlLinkExpiresAt?.toISOString() ?? null,
    newUsers30d,
    players30d,
  }
}

export interface ChannelsOverview {
  available: boolean
  slug: string | null
  urlLinkEnabled: boolean
  channels: ChannelRow[]
}

export async function listChannels(workId: string): Promise<ChannelsOverview> {
  const work = await prisma.mpWork.findUnique({ where: { workId }, select: { id: true, slug: true, status: true } })
  const available = !!work && (work.status === 'live' || work.status === 'scheduled')
  if (!work || !available) return { available: false, slug: work?.slug ?? null, urlLinkEnabled: urlLinkEnabled(), channels: [] }
  const rows = await prisma.mpChannel.findMany({ where: { mpWorkId: work.id, archived: false }, orderBy: { createdAt: 'desc' } })
  const ids = rows.map((row) => row.id)
  const since = new Date(Date.now() - STATS_WINDOW_MS)
  const [newUserGroups, playEvents] = ids.length
    ? await Promise.all([
      prisma.consumerUser.groupBy({ by: ['firstChannelId'], where: { firstChannelId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.mpEvent.findMany({
        where: { channelId: { in: ids }, name: 'play_start', createdAt: { gte: since }, consumerId: { not: null } },
        distinct: ['consumerId', 'channelId'],
        select: { consumerId: true, channelId: true },
      }),
    ])
    : [[], []]
  const newUsers = new Map<string, number>()
  for (const group of newUserGroups) {
    if (group.firstChannelId) newUsers.set(group.firstChannelId, group._count._all)
  }
  const players = new Map<string, number>()
  for (const event of playEvents) {
    if (event.channelId) players.set(event.channelId, (players.get(event.channelId) ?? 0) + 1)
  }
  const channels = await Promise.all(rows.map((row) => toChannelRow(row, work.slug, newUsers.get(row.id) ?? 0, players.get(row.id) ?? 0)))
  return { available: true, slug: work.slug, urlLinkEnabled: urlLinkEnabled(), channels }
}

async function freshOrRenewLink(channel: MpChannel): Promise<{ urlLink: string; urlLinkExpiresAt: string }> {
  if (channel.urlLink && channel.urlLinkExpiresAt && channel.urlLinkExpiresAt.getTime() - Date.now() >= URL_LINK_RENEW_MS) {
    return { urlLink: channel.urlLink, urlLinkExpiresAt: channel.urlLinkExpiresAt.toISOString() }
  }
  const target = await targetOf(channel.mpWorkId, channel.topicId, channel.code)
  const urlLink = await generateUrlLink(target.path, target.query)
  const urlLinkExpiresAt = new Date(Date.now() + URL_LINK_TTL_DAYS * 24 * 3600 * 1000)
  await prisma.mpChannel.update({ where: { id: channel.id }, data: { urlLink, urlLinkExpiresAt } })
  return { urlLink, urlLinkExpiresAt: urlLinkExpiresAt.toISOString() }
}

export async function renewChannelUrlLink(workId: string, channelId: string): Promise<{ urlLink: string; urlLinkExpiresAt: string }> {
  if (!urlLinkEnabled()) throw new MpApiError('MP_INVALID_STATE', { message: '外链功能未开启' })
  const work = await prisma.mpWork.findUnique({ where: { workId }, select: { id: true } })
  const channel = work ? await prisma.mpChannel.findFirst({ where: { id: channelId, mpWorkId: work.id } }) : null
  if (!channel) throw new MpApiError('MP_VALIDATION', { message: '渠道不存在' })
  if (channel.archived) throw new MpApiError('MP_INVALID_STATE', { message: '渠道已归档' })
  return freshOrRenewLink(channel)
}

export async function renewOpsChannelUrlLink(channelId: string): Promise<{ urlLink: string; urlLinkExpiresAt: string }> {
  if (!urlLinkEnabled()) throw new MpApiError('MP_INVALID_STATE', { message: '外链功能未开启' })
  const channel = await prisma.mpChannel.findFirst({ where: { id: channelId, kind: 'ops' } })
  if (!channel) throw new MpApiError('MP_VALIDATION', { message: '渠道不存在' })
  if (channel.archived) throw new MpApiError('MP_INVALID_STATE', { message: '渠道已归档' })
  return freshOrRenewLink(channel)
}

export async function archiveChannel(workId: string, channelId: string): Promise<{ ok: true }> {
  const work = await prisma.mpWork.findUnique({ where: { workId }, select: { id: true } })
  const result = work
    ? await prisma.mpChannel.updateMany({ where: { id: channelId, mpWorkId: work.id, archived: false }, data: { archived: true } })
    : { count: 0 }
  if (result.count === 0) throw new MpApiError('MP_VALIDATION', { message: '渠道不存在' })
  return { ok: true }
}
