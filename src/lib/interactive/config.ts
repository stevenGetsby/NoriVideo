import {
  STORY_ASPECT_RATIOS,
  STORY_CHAPTER_STATUSES,
  STORY_RESOLUTIONS,
  type InteractiveStoryConfig,
  type StoryAspectRatio,
  type StoryChapterMeta,
  type StoryChapterStatus,
  type StoryLink,
  type StoryResolution,
  type StoryStart,
  type StoryVariable,
} from './types'

export const STORY_VARIABLE_LIMIT = 50
export const STORY_VARIABLE_NAME_MAX = 24
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export const EMPTY_STORY_CONFIG: InteractiveStoryConfig = { version: 1, variables: [], chapters: [], links: [], start: null }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value)
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

export function isStoryAspectRatio(value: unknown): value is StoryAspectRatio {
  return STORY_ASPECT_RATIOS.includes(value as StoryAspectRatio)
}

export function isStoryResolution(value: unknown): value is StoryResolution {
  return STORY_RESOLUTIONS.includes(value as StoryResolution)
}

function readVariable(raw: unknown): StoryVariable | null {
  if (!isRecord(raw) || !isId(raw.id)) return null
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, STORY_VARIABLE_NAME_MAX) : ''
  if (!name) return null
  if (raw.type === 'boolean') return { id: raw.id, name, type: 'boolean', initial: raw.initial === true }
  if (raw.type === 'number') return { id: raw.id, name, type: 'number', initial: finite(raw.initial, 0) }
  return null
}

function readChapter(raw: unknown, index: number): StoryChapterMeta | null {
  if (!isRecord(raw) || typeof raw.projectId !== 'string' || !raw.projectId) return null
  const position = isRecord(raw.position) ? raw.position : {}
  const status = STORY_CHAPTER_STATUSES.includes(raw.status as StoryChapterStatus) ? raw.status as StoryChapterStatus : 'drafting'
  return {
    projectId: raw.projectId,
    order: finite(raw.order, index),
    position: { x: finite(position.x, index * 320), y: finite(position.y, 0) },
    status,
  }
}

function readLink(raw: unknown): StoryLink | null {
  if (!isRecord(raw) || !isId(raw.id)) return null
  const { fromProjectId, exitNodeId, toProjectId, toEntryNodeId } = raw
  if (![fromProjectId, exitNodeId, toProjectId, toEntryNodeId].every((v) => typeof v === 'string' && v)) return null
  return { id: raw.id, fromProjectId, exitNodeId, toProjectId, toEntryNodeId } as StoryLink
}

function readStart(raw: unknown): StoryStart | null {
  if (!isRecord(raw) || typeof raw.projectId !== 'string' || typeof raw.entryNodeId !== 'string') return null
  if (!raw.projectId || !raw.entryNodeId) return null
  return { projectId: raw.projectId, entryNodeId: raw.entryNodeId }
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Tolerant read of a stored config: drops malformed entries instead of failing. */
export function normalizeStoryConfig(raw: unknown): InteractiveStoryConfig {
  if (!isRecord(raw)) return { ...EMPTY_STORY_CONFIG }
  const list = (value: unknown) => (Array.isArray(value) ? value : [])
  const variables = uniqueBy(list(raw.variables).map(readVariable).filter((v): v is StoryVariable => !!v), (v) => v.id)
  const chapters = uniqueBy(list(raw.chapters).map(readChapter).filter((c): c is StoryChapterMeta => !!c), (c) => c.projectId)
  const links = uniqueBy(
    uniqueBy(list(raw.links).map(readLink).filter((l): l is StoryLink => !!l), (l) => l.id),
    (l) => `${l.fromProjectId}:${l.exitNodeId}`,
  )
  return { version: 1, variables: variables.slice(0, STORY_VARIABLE_LIMIT), chapters, links, start: readStart(raw.start) }
}

export type StoryConfigInputResult = { ok: true; config: InteractiveStoryConfig } | { ok: false; message: string }

/** Strict check for client-submitted configs; rejects instead of silently dropping. */
export function parseStoryConfigInput(raw: unknown): StoryConfigInputResult {
  if (!isRecord(raw)) return { ok: false, message: '故事配置格式错误。' }
  const variables = Array.isArray(raw.variables) ? raw.variables : []
  if (variables.length > STORY_VARIABLE_LIMIT) return { ok: false, message: `全局变量最多 ${STORY_VARIABLE_LIMIT} 个。` }
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const item of variables) {
    const variable = readVariable(item)
    if (!variable) return { ok: false, message: '全局变量需要合法的 ID、名称和类型。' }
    if (ids.has(variable.id)) return { ok: false, message: '全局变量 ID 重复。' }
    if (names.has(variable.name)) return { ok: false, message: `全局变量「${variable.name}」重名。` }
    ids.add(variable.id)
    names.add(variable.name)
  }
  const links = Array.isArray(raw.links) ? raw.links : []
  if (links.some((link) => !readLink(link))) return { ok: false, message: '章节连线格式错误。' }
  const exits = new Set<string>()
  for (const link of links.map(readLink) as StoryLink[]) {
    const key = `${link.fromProjectId}:${link.exitNodeId}`
    if (exits.has(key)) return { ok: false, message: '同一个出口只能连接一个下一章入口。' }
    exits.add(key)
  }
  if (raw.start != null && !readStart(raw.start)) return { ok: false, message: '故事起点格式错误。' }
  return { ok: true, config: normalizeStoryConfig(raw) }
}

/** Keeps config chapters in sync with the 作品 that actually exist under the project. */
export function reconcileStoryChapters(config: InteractiveStoryConfig, projectIds: string[]): InteractiveStoryConfig {
  const alive = new Set(projectIds)
  const kept = config.chapters.filter((chapter) => alive.has(chapter.projectId))
  const known = new Set(kept.map((chapter) => chapter.projectId))
  const appended = projectIds.filter((id) => !known.has(id)).map((projectId, index): StoryChapterMeta => {
    const order = kept.length + index
    return { projectId, order, position: { x: order * 340, y: 0 }, status: 'drafting' }
  })
  const chapters = [...kept, ...appended]
    .sort((a, b) => a.order - b.order)
    .map((chapter, order) => ({ ...chapter, order }))
  const links = config.links.filter((link) => alive.has(link.fromProjectId) && alive.has(link.toProjectId))
  const start = config.start && alive.has(config.start.projectId) ? config.start : null
  return { ...config, chapters, links, start }
}
