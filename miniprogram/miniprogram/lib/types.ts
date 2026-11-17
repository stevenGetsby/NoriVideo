import type { Card, ContinueCard, MpMe, Slot, TopicCard } from '@/lib/mp/dto'
import type { StoryProfile } from '@/lib/interactive/achievements'
import type { StorySaves } from '@/lib/interactive/saves'
import type { PermanentValues } from '@/lib/mp/save-merge'

export type { Card, Slot, ContinueCard, TopicCard, WorkDetail, PlayManifest, MpMe } from '@/lib/mp/dto'

// 与 src/lib/mp/stats.ts 的 ReleaseStats 保持同构；本地定义避免把服务端依赖拉进小程序类型图。
export interface ReleaseStats {
  choices: Record<string, Record<string, number>>
  endings: Record<string, number>
}

export interface ApiError {
  code: string
  message?: string
  status?: number
  details?: unknown
}

export interface LoginResponse {
  token: string
  expiresAt: string
  user: MpMe
  isNew: boolean
}

export interface HomeResponse {
  hero: Slot[]
  picks: Slot[]
  continue: ContinueCard[]
  hot: Card[]
  newest: Card[]
  upcoming: Card[]
  topics: TopicCard[]
}

export interface ListResponse {
  items: Card[]
  nextCursor: string | null
}

export interface ItemsResponse {
  items: Card[]
}

export interface HistoryResponse {
  items: ContinueCard[]
  nextCursor: string | null
}

export interface TopicResponse {
  topic: { slug: string; title: string; subtitle: string; description: string; cover: string }
  items: Card[]
}

export interface SaveResponse {
  rev: number
  releaseId: string | null
  profile: StoryProfile
  saves: StorySaves
  permanent: PermanentValues
}

export interface PutSaveResponse {
  rev: number
  merged: boolean
  profile: StoryProfile
  saves: StorySaves
  permanent: PermanentValues
}

export interface SavePutBody {
  baseRev: number
  releaseId: string
  profile: StoryProfile
  saves: StorySaves
  permanent: PermanentValues
  progress: number
  endingsGot: number
}
