import { carriedPermanent, initialVariables, type StoryRun, type StoryRunMode, type StoryStop, type StoryTrailStep } from './engine'
import { STORY_PERSONALITY_TAGS, type StoryNodeKind, type StoryProgram, type StoryVariables } from './types'
import type { StoryPersonalityCounts } from './personality'
import { reachKey, type StoryProfile } from './achievements'

const NODE_KINDS: readonly StoryNodeKind[] = ['entry', 'scene', 'choice', 'condition', 'exit', 'ending', 'interaction']
const SNAPSHOT_TRAIL_STEPS = 40
const SNAPSHOT_TITLE_MAX = 80

export const STORY_SAVE_SLOTS = 3
export const STORY_CHECKPOINT_LIMIT = 40

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** Everything a play needs to continue from the start of one stop. Plain JSON, so it can sit in browser storage. */
export interface StoryRunSnapshot {
  v: 1
  mode: StoryRunMode
  projectId: string
  nodeId: string
  vars: StoryVariables
  trail: StoryTrailStep[]
  purchases?: Record<string, number>
  personality?: StoryPersonalityCounts
}

/**
 * The snapshot of a run, or null when it has nowhere to continue from (an ending, an exit, a dead end).
 * Take it from the run as it was when the stop was entered: values a mounted interaction changes later
 * are not in it, so replaying the segment cannot apply them twice.
 */
export function snapshotRun(run: StoryRun): StoryRunSnapshot | null {
  const { stop } = run
  if (stop.kind !== 'scene' && stop.kind !== 'choice' && stop.kind !== 'interaction') return null
  const purchases = run.purchases && Object.keys(run.purchases).length ? { purchases: { ...run.purchases } } : {}
  const personality = run.personality && Object.keys(run.personality).length ? { personality: { ...run.personality } } : {}
  return {
    v: 1,
    mode: run.mode,
    projectId: stop.projectId,
    nodeId: stop.node.id,
    vars: { ...run.vars },
    trail: run.trail.slice(-SNAPSHOT_TRAIL_STEPS).map((step) => ({ ...step })),
    ...purchases,
    ...personality,
  }
}

function readTrailStep(raw: unknown): StoryTrailStep[] {
  if (!isRecord(raw) || !nonEmpty(raw.projectId) || !nonEmpty(raw.nodeId) || !NODE_KINDS.includes(raw.kind as StoryNodeKind)) return []
  return [{
    projectId: raw.projectId,
    nodeId: raw.nodeId,
    kind: raw.kind as StoryNodeKind,
    title: typeof raw.title === 'string' ? raw.title.slice(0, SNAPSHOT_TITLE_MAX) : '',
    ...(typeof raw.choice === 'string' ? { choice: raw.choice.slice(0, SNAPSHOT_TITLE_MAX) } : {}),
  }]
}

function readCounts(raw: unknown, accept: (key: string) => boolean = () => true): Record<string, number> | undefined {
  if (!isRecord(raw)) return undefined
  const counts: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (accept(key) && typeof value === 'number' && Number.isFinite(value) && value > 0) counts[key] = Math.floor(value)
  }
  return Object.keys(counts).length ? counts : undefined
}

/** Lenient read of a stored snapshot: wrong shapes read as null, bad entries inside are dropped. */
export function readSnapshot(raw: unknown): StoryRunSnapshot | null {
  if (!isRecord(raw) || raw.v !== 1) return null
  if (raw.mode !== 'story' && raw.mode !== 'chapter') return null
  if (!nonEmpty(raw.projectId) || !nonEmpty(raw.nodeId)) return null
  const vars: StoryVariables = {}
  if (isRecord(raw.vars)) {
    for (const [key, value] of Object.entries(raw.vars)) {
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) vars[key] = value
    }
  }
  const purchases = readCounts(raw.purchases)
  const personality = readCounts(raw.personality, (key) => STORY_PERSONALITY_TAGS.includes(key as (typeof STORY_PERSONALITY_TAGS)[number]))
  return {
    v: 1,
    mode: raw.mode,
    projectId: raw.projectId,
    nodeId: raw.nodeId,
    vars,
    trail: (Array.isArray(raw.trail) ? raw.trail : []).flatMap(readTrailStep).slice(-SNAPSHOT_TRAIL_STEPS),
    ...(purchases ? { purchases } : {}),
    ...(personality ? { personality: personality as StoryPersonalityCounts } : {}),
  }
}

/**
 * Puts a play back where a snapshot was taken, or null when that stop no longer exists (the story was edited).
 * The segment is entered as it was, with the values the snapshot already holds: its own value effects are NOT
 * applied again. Permanent values come from `options.permanent` (the viewer's current ones), never from the old save,
 * so loading cannot roll back progress that is meant to last; values the story no longer has are dropped.
 */
export function restoreRun(program: StoryProgram, snapshot: StoryRunSnapshot, options: { permanent?: StoryVariables } = {}): StoryRun | null {
  const chapter = program.chapters.find((item) => item.projectId === snapshot.projectId)
  const node = chapter?.nodes.find((item) => item.id === snapshot.nodeId)
  if (!chapter || !node) return null
  let stop: StoryStop
  if (node.kind === 'scene') stop = { kind: 'scene', projectId: chapter.projectId, node }
  else if (node.kind === 'choice') stop = { kind: 'choice', projectId: chapter.projectId, node }
  else if (node.kind === 'interaction') stop = { kind: 'interaction', projectId: chapter.projectId, node }
  else return null
  const vars = initialVariables(program.variables, { ...snapshot.vars, ...carriedPermanent(program.variables, options.permanent) })
  return {
    mode: snapshot.mode,
    vars,
    stop,
    trail: snapshot.trail.map((step) => ({ ...step })),
    ...(snapshot.purchases ? { purchases: { ...snapshot.purchases } } : {}),
    ...(snapshot.personality ? { personality: { ...snapshot.personality } } : {}),
  }
}

/** Where a snapshot sits in the story, for a slot's caption; null when the story no longer has that stop. */
export function snapshotLabel(program: StoryProgram, snapshot: StoryRunSnapshot): { chapter: string; node: string } | null {
  const chapter = program.chapters.find((item) => item.projectId === snapshot.projectId)
  const node = chapter?.nodes.find((item) => item.id === snapshot.nodeId)
  if (!chapter || !node) return null
  return { chapter: chapter.title, node: node.kind === 'scene' && node.savePoint ? node.savePoint.name || node.title : node.title }
}

export interface StorySaveSlot {
  savedAt: number
  snapshot: StoryRunSnapshot
}

/** One work's saves in the viewer's browser: the automatic one, three manual slots, and the latest state at each save point. */
export interface StorySaves {
  auto: StorySaveSlot | null
  slots: Array<StorySaveSlot | null>
  checkpoints: Record<string, StorySaveSlot>
}

export const emptySaves = (): StorySaves => ({ auto: null, slots: Array.from({ length: STORY_SAVE_SLOTS }, () => null), checkpoints: {} })

function readSlot(raw: unknown): StorySaveSlot | null {
  if (!isRecord(raw)) return null
  const snapshot = readSnapshot(raw.snapshot)
  if (!snapshot) return null
  return { savedAt: typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : 0, snapshot }
}

/** Lenient read of stored saves: broken slots read as empty, the rest survives. */
export function readSaves(raw: unknown): StorySaves {
  if (!isRecord(raw)) return emptySaves()
  const slots = Array.isArray(raw.slots) ? raw.slots : []
  const checkpoints: Record<string, StorySaveSlot> = {}
  if (isRecord(raw.checkpoints)) {
    for (const [key, value] of Object.entries(raw.checkpoints).slice(0, STORY_CHECKPOINT_LIMIT)) {
      const slot = readSlot(value)
      if (slot) checkpoints[key] = slot
    }
  }
  return {
    auto: readSlot(raw.auto),
    slots: Array.from({ length: STORY_SAVE_SLOTS }, (_, index) => readSlot(slots[index])),
    checkpoints,
  }
}

export const withAutoSave = (saves: StorySaves, snapshot: StoryRunSnapshot, now: number): StorySaves => ({ ...saves, auto: { savedAt: now, snapshot } })

export function withManualSave(saves: StorySaves, index: number, snapshot: StoryRunSnapshot, now: number): StorySaves {
  if (!Number.isInteger(index) || index < 0 || index >= STORY_SAVE_SLOTS) return saves
  return { ...saves, slots: saves.slots.map((slot, at) => (at === index ? { savedAt: now, snapshot } : slot)) }
}

export function withoutManualSave(saves: StorySaves, index: number): StorySaves {
  if (!Number.isInteger(index) || index < 0 || index >= STORY_SAVE_SLOTS || !saves.slots[index]) return saves
  return { ...saves, slots: saves.slots.map((slot, at) => (at === index ? null : slot)) }
}

export function withCheckpoint(saves: StorySaves, key: string, snapshot: StoryRunSnapshot, now: number): StorySaves {
  const entries = Object.entries({ ...saves.checkpoints, [key]: { savedAt: now, snapshot } })
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, STORY_CHECKPOINT_LIMIT)
  return { ...saves, checkpoints: Object.fromEntries(entries) }
}

export const savesEnabled = (program: StoryProgram) => program.map?.enabled === true

/** Remembers the state at a save point the run has just entered; the saves stay as they were anywhere else or while the map is off. */
export function observeCheckpoint(program: StoryProgram, saves: StorySaves, run: StoryRun, now: number): StorySaves {
  const { stop } = run
  if (!savesEnabled(program) || stop.kind !== 'scene' || !stop.node.savePoint) return saves
  const snapshot = snapshotRun(run)
  return snapshot ? withCheckpoint(saves, reachKey(stop.projectId, stop.node.id), snapshot, now) : saves
}

export interface StoryMapPoint {
  key: string
  projectId: string
  nodeId: string
  name: string
  coverUrl: string | null
  chapterTitle: string
  unlocked: boolean
  /** The save point the viewer passed most recently in this play. */
  current: boolean
  /** Depth along the routes, for placing points in columns so that every route runs forward. */
  rank: number
}

export interface StoryMapRoute {
  from: string
  to: string
  /** Both ends are unlocked. */
  lit: boolean
}

export interface StoryMapView {
  points: StoryMapPoint[]
  routes: StoryMapRoute[]
}

type Place = { projectId: string; nodeId: string }

/**
 * The creator's save points and the routes between them, with the ones the viewer has reached unlocked.
 * A route runs from one save point to the next one the story can reach without passing another.
 */
export function storyMap(program: StoryProgram, profile: Pick<StoryProfile, 'segments'>, run?: StoryRun): StoryMapView {
  const chapters = new Map(program.chapters.map((chapter) => [chapter.projectId, chapter]))
  const nodeAt = ({ projectId, nodeId }: Place) => chapters.get(projectId)?.nodes.find((node) => node.id === nodeId)

  function successors(place: Place): Place[] {
    const chapter = chapters.get(place.projectId)
    const node = nodeAt(place)
    if (!chapter || !node) return []
    if (node.kind === 'exit') {
      const link = program.links.find((item) => item.fromProjectId === place.projectId && item.exitNodeId === node.id)
      return link ? [{ projectId: link.toProjectId, nodeId: link.toEntryNodeId }] : []
    }
    const sources = new Set([node.id, ...(node.kind === 'scene' ? node.beats.map((beat) => beat.id) : [])])
    return chapter.flows.filter((flow) => sources.has(flow.from)).map((flow) => ({ projectId: place.projectId, nodeId: flow.to }))
  }

  const keyOf = (place: Place) => reachKey(place.projectId, place.nodeId)
  const isPoint = (place: Place) => {
    const node = nodeAt(place)
    return node?.kind === 'scene' && Boolean(node.savePoint)
  }

  // Story order: walk from the start, then add whatever the walk never reached.
  const order: Place[] = []
  const seen = new Set<string>()
  const queue: Place[] = program.start ? [{ projectId: program.start.projectId, nodeId: program.start.entryNodeId }] : []
  while (queue.length) {
    const place = queue.shift() as Place
    if (seen.has(keyOf(place))) continue
    seen.add(keyOf(place))
    if (isPoint(place)) order.push(place)
    queue.push(...successors(place))
  }
  for (const chapter of program.chapters) {
    for (const node of chapter.nodes) {
      const place = { projectId: chapter.projectId, nodeId: node.id }
      if (!seen.has(keyOf(place)) && isPoint(place)) order.push(place)
    }
  }

  const unlocked = new Set(profile.segments)
  const routes: StoryMapRoute[] = []
  const known = new Set(order.map(keyOf))
  for (const origin of order) {
    const visited = new Set([keyOf(origin)])
    const walk = [...successors(origin)]
    const reached = new Set<string>()
    while (walk.length) {
      const place = walk.shift() as Place
      const key = keyOf(place)
      if (visited.has(key)) continue
      visited.add(key)
      if (known.has(key)) {
        reached.add(key)
        continue
      }
      walk.push(...successors(place))
    }
    for (const to of reached) routes.push({ from: keyOf(origin), to, lit: unlocked.has(keyOf(origin)) && unlocked.has(to) })
  }

  // Longest-path layering. A route back into a save point still being walked closes a loop and is left out.
  const keys = order.map(keyOf)
  const incoming = new Set(routes.map((route) => route.to))
  const roots = keys.filter((key) => !incoming.has(key))
  const state = new Map<string, 'walking' | 'done'>()
  const finished: string[] = []
  const forward: Array<readonly [string, string]> = []
  const walkFrom = (key: string) => {
    state.set(key, 'walking')
    for (const route of routes) {
      if (route.from !== key || state.get(route.to) === 'walking') continue
      forward.push([key, route.to])
      if (!state.has(route.to)) walkFrom(route.to)
    }
    state.set(key, 'done')
    finished.push(key)
  }
  for (const key of [...(roots.length ? roots : keys.slice(0, 1)), ...keys]) if (!state.has(key)) walkFrom(key)
  const ranks = new Map<string, number>()
  for (const key of [...finished].reverse()) {
    const rank = ranks.get(key) ?? 0
    ranks.set(key, rank)
    for (const [from, to] of forward) if (from === key) ranks.set(to, Math.max(ranks.get(to) ?? 0, rank + 1))
  }

  let current: string | null = null
  for (let index = (run?.trail.length ?? 0) - 1; index >= 0 && !current; index -= 1) {
    const step = run?.trail[index]
    if (step && step.kind === 'scene' && known.has(reachKey(step.projectId, step.nodeId))) current = reachKey(step.projectId, step.nodeId)
  }

  const points = order.map((place): StoryMapPoint => {
    const node = nodeAt(place)
    const key = keyOf(place)
    const savePoint = node?.kind === 'scene' ? node.savePoint : undefined
    return {
      key,
      projectId: place.projectId,
      nodeId: place.nodeId,
      name: savePoint?.name || node?.title || '',
      coverUrl: savePoint?.coverUrl ?? null,
      chapterTitle: chapters.get(place.projectId)?.title ?? '',
      unlocked: unlocked.has(key),
      current: key === current,
      rank: ranks.get(key) ?? 0,
    }
  })
  return { points, routes }
}
