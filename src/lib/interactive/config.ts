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
  type StorySequence,
  type StorySequenceSegment,
  type StoryStart,
  type StoryVariable,
} from './types'

export const STORY_VARIABLE_LIMIT = 50
export const STORY_VARIABLE_NAME_MAX = 24
export const STORY_SEQUENCE_SEGMENT_LIMIT = 400
const SEGMENT_TITLE_MAX = 80
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

function readSequenceSegment(raw: unknown): StorySequenceSegment | null {
  if (!isRecord(raw) || !isId(raw.id)) return null
  if (typeof raw.projectId !== 'string' || !raw.projectId) return null
  if (typeof raw.sceneNodeId !== 'string' || !raw.sceneNodeId) return null
  return {
    id: raw.id,
    projectId: raw.projectId,
    sceneNodeId: raw.sceneNodeId,
    title: typeof raw.title === 'string' ? raw.title.trim().slice(0, SEGMENT_TITLE_MAX) : '',
    branch: raw.branch === true,
    removed: raw.removed === true,
  }
}

function readSequence(raw: unknown): StorySequence | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.segments)) return undefined
  const seenIds = new Set<string>()
  const seenScenes = new Set<string>()
  const segments: StorySequenceSegment[] = []
  for (const item of raw.segments) {
    const segment = readSequenceSegment(item)
    if (!segment) continue
    const sceneKey = `${segment.projectId}:${segment.sceneNodeId}`
    if (seenIds.has(segment.id) || seenScenes.has(sceneKey)) continue
    seenIds.add(segment.id)
    seenScenes.add(sceneKey)
    segments.push(segment)
    if (segments.length >= STORY_SEQUENCE_SEGMENT_LIMIT) break
  }
  return { segments }
}

/** Returns the first chapter-link cycle, or null. Reserved for PATCH and preview checks. */
export function findStoryLinkCycle(links: StoryLink[]): string | null {
  const outgoing = new Map<string, string[]>()
  for (const link of links) {
    const list = outgoing.get(link.fromProjectId)
    if (list) list.push(link.toProjectId)
    else outgoing.set(link.fromProjectId, [link.toProjectId])
  }
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (projectId: string): string | null => {
    if (state.get(projectId) === 'visiting') return projectId
    if (state.get(projectId) === 'done') return null
    state.set(projectId, 'visiting')
    for (const next of outgoing.get(projectId) ?? []) {
      const found = visit(next)
      if (found) return found
    }
    state.set(projectId, 'done')
    return null
  }
  for (const projectId of outgoing.keys()) {
    const found = visit(projectId)
    if (found) return found
  }
  return null
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
  const sequence = readSequence(raw.sequence)
  return {
    version: 1,
    variables: variables.slice(0, STORY_VARIABLE_LIMIT),
    chapters,
    links,
    start: readStart(raw.start),
    ...(sequence ? { sequence } : {}),
  }
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
  if (raw.chapters !== undefined) {
    if (!Array.isArray(raw.chapters)) return { ok: false, message: '章节配置格式错误。' }
    const chapterIds = new Set<string>()
    for (const [index, item] of raw.chapters.entries()) {
      const chapter = readChapter(item, index)
      if (!chapter) return { ok: false, message: '章节配置格式错误。' }
      if (chapterIds.has(chapter.projectId)) return { ok: false, message: '章节重复。' }
      chapterIds.add(chapter.projectId)
    }
  }
  const links = Array.isArray(raw.links) ? raw.links : []
  if (links.some((link) => !readLink(link))) return { ok: false, message: '章节连线格式错误。' }
  const exits = new Set<string>()
  const linkIds = new Set<string>()
  for (const link of links.map(readLink) as StoryLink[]) {
    if (linkIds.has(link.id)) return { ok: false, message: '章节连线 ID 重复。' }
    linkIds.add(link.id)
    const key = `${link.fromProjectId}:${link.exitNodeId}`
    if (exits.has(key)) return { ok: false, message: '同一个出口只能连接一个下一章入口。' }
    exits.add(key)
  }
  if (raw.sequence !== undefined && raw.sequence !== null) {
    if (!isRecord(raw.sequence) || !Array.isArray(raw.sequence.segments)) return { ok: false, message: '作品片段配置格式错误。' }
    if (raw.sequence.segments.length > STORY_SEQUENCE_SEGMENT_LIMIT) {
      return { ok: false, message: `作品片段最多 ${STORY_SEQUENCE_SEGMENT_LIMIT} 个。` }
    }
    const segmentIds = new Set<string>()
    const segmentScenes = new Set<string>()
    for (const item of raw.sequence.segments) {
      const segment = readSequenceSegment(item)
      if (!segment) return { ok: false, message: '作品片段缺少合法的 ID、章节或剧情片段。' }
      if (segmentIds.has(segment.id)) return { ok: false, message: '作品片段 ID 重复。' }
      const sceneKey = `${segment.projectId}:${segment.sceneNodeId}`
      if (segmentScenes.has(sceneKey)) return { ok: false, message: '同一个剧情片段只能关联一个作品片段。' }
      segmentIds.add(segment.id)
      segmentScenes.add(sceneKey)
    }
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
