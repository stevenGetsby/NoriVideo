import { readProfile, type StoryProfile } from '@/lib/interactive/achievements'
import { readSaves, STORY_CHECKPOINT_LIMIT, STORY_SAVE_SLOTS, type StorySaveSlot, type StorySaves } from '@/lib/interactive/saves'

export type PermanentValues = Record<string, number | boolean | string>

export interface SaveState {
  profile: StoryProfile
  saves: StorySaves
  permanent: PermanentValues
}

export interface SaveStateInput {
  profile?: unknown
  saves?: unknown
  permanent?: unknown
}

function readPermanent(raw: unknown): PermanentValues {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const values: PermanentValues = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) values[key] = value
    else if (typeof value === 'boolean' || typeof value === 'string') values[key] = value
  }
  return values
}

// 并集保留服务端顺序，客户端新增的追加在后面（F.7）。
function unionList(server: string[], client: string[]): string[] {
  const seen = new Set(server)
  const merged = [...server]
  for (const item of client) {
    if (!seen.has(item)) {
      seen.add(item)
      merged.push(item)
    }
  }
  return merged
}

// savedAt 较新的一方；相等时保留服务端，避免无意义的翻转。
function newerSlot(server: StorySaveSlot | null, client: StorySaveSlot | null): StorySaveSlot | null {
  if (!server) return client
  if (!client) return server
  return client.savedAt > server.savedAt ? client : server
}

export function normalizeSaveState(input: SaveStateInput): SaveState {
  return { profile: readProfile(input.profile), saves: readSaves(input.saves), permanent: readPermanent(input.permanent) }
}

/** 云存档合并（F.7），纯函数，客户端与服务端共用。 */
export function mergeSaveState(serverInput: SaveStateInput, clientInput: SaveStateInput): SaveState {
  const server = normalizeSaveState(serverInput)
  const client = normalizeSaveState(clientInput)

  const profile: StoryProfile = {
    endings: unionList(server.profile.endings, client.profile.endings),
    segments: unionList(server.profile.segments, client.profile.segments),
    achievements: unionList(server.profile.achievements, client.profile.achievements),
    bought: unionList(server.profile.bought, client.profile.bought),
    equipped: client.profile.equipped,
  }

  const checkpoints: Record<string, StorySaveSlot> = { ...server.saves.checkpoints }
  for (const [key, slot] of Object.entries(client.saves.checkpoints)) {
    checkpoints[key] = newerSlot(checkpoints[key] ?? null, slot) as StorySaveSlot
  }
  const cappedCheckpoints = Object.fromEntries(
    Object.entries(checkpoints).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, STORY_CHECKPOINT_LIMIT),
  )

  const saves: StorySaves = {
    auto: newerSlot(server.saves.auto, client.saves.auto),
    slots: Array.from({ length: STORY_SAVE_SLOTS }, (_, index) => newerSlot(server.saves.slots[index] ?? null, client.saves.slots[index] ?? null)),
    checkpoints: cappedCheckpoints,
  }

  const permanent: PermanentValues = { ...server.permanent }
  for (const [key, value] of Object.entries(client.permanent)) {
    const prev = server.permanent[key]
    if (typeof value === 'number' && typeof prev === 'number') permanent[key] = Math.max(prev, value)
    else if (typeof value === 'boolean' && typeof prev === 'boolean') permanent[key] = prev || value
    else permanent[key] = value
  }

  return { profile, saves, permanent }
}
