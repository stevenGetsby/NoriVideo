import { readProfile } from '@/lib/interactive/achievements'

export interface Card {
  slug: string
  title: string
  tagline: string
  cover: string
  accentColor: string
  tags: string[]
  status: 'live' | 'scheduled'
  players: number
  endingCount: number
  ratingScore: number | null
  scheduledAt?: string
  reserveCount?: number
}

export interface Slot {
  title: string
  subtitle: string
  image: string
  target: { type: 'work' | 'topic'; slug: string }
  card?: Card
}

export interface ContinueCard {
  card: Card
  progress: number
  endingsGot: number
  lastPlayedAt: string
}

export interface TopicCard {
  slug: string
  title: string
  subtitle: string
  cover: string
}

export interface WorkDetail {
  work: Card & {
    synopsis: string
    creatorName: string
    shareCover: string
    trailer: { url: string; poster: string } | null
    chapterCount: number
    totalDurationSec: number
    ratingCount: number
    aspectRatio: string
    releaseId: string | null
    version: number | null
  }
  chapters: { order: number; title: string; durationSec: number }[]
  endings: { nodeId: string; endingType: 'good' | 'normal' | 'bad' | 'hidden'; title: string | null }[]
  achievements: { id: string; name: string; description: string; icon: string | null }[]
  viewer: null | {
    favorited: boolean
    rating: number | null
    reserved: boolean
    hasSave: boolean
    endingsGot: string[]
    achievementsGot: string[]
    progress: number
  }
}

export interface PlayManifest {
  releaseId: string
  version: number
  aspectRatio: string
  programUrl: string
  programHash: string
  media: Record<string, {
    kind: 'video' | 'image'
    w: number
    h: number
    dur?: number
    v720?: string
    v480?: string
    poster?: string
    last?: string
    img?: string
  }>
  expiresAt: string
  stats: string
}

export interface MpMe {
  id: string
  nickname: string
  avatarIndex: number
  stats: { played: number; endings: number; achievements: number }
}

export interface MpMeSaveRow {
  endingsGot: number
  profile: unknown
}

export function toMpMe(user: { id: string; nickname: string; avatarIndex: number }, saves: MpMeSaveRow[]): MpMe {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarIndex: user.avatarIndex,
    stats: {
      played: saves.length,
      endings: saves.reduce((sum, save) => sum + save.endingsGot, 0),
      achievements: saves.reduce((sum, save) => sum + readProfile(save.profile).achievements.length, 0),
    },
  }
}
