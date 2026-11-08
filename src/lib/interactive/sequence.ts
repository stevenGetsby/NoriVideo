import {
  STORY_ELSE_HANDLE,
  STORY_OUTPUT_HANDLE,
  type StoryChapterGraph,
  type StoryChapterMeta,
  type StoryFlow,
  type StoryMedia,
  type StoryNode,
  type StorySceneNode,
  type StorySequence,
  type StorySequenceSegment,
} from './types'

/** One chapter as the work canvas sees it: graph plus the canvas it drills into. */
export interface WorkSequenceChapter {
  projectId: string
  name: string
  canvasId: string | null
  graph: StoryChapterGraph
}

export type SequenceOrphanKind = 'project' | 'scene'

export interface ResolvedSequenceSegment {
  segment: StorySequenceSegment
  chapterName: string
  canvasId: string | null
  scene: StorySceneNode | null
  media: StoryMedia | null
  orphan: SequenceOrphanKind | null
}

export interface SequenceStats {
  total: number
  linear: number
  cut: number
  branch: number
  removed: number
  orphaned: number
  ready: number
}

const TITLE_MAX = 80
const sceneTitle = (node: StorySceneNode) => node.title.trim().slice(0, TITLE_MAX) || '剧情片段'

/** Stable per scene so an old config can migrate without inventing new ids on every read. */
export function sequenceSegmentId(projectId: string, sceneNodeId: string): string {
  return `seg_${projectId}_${sceneNodeId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
}

export function sequenceSegmentKey(projectId: string, sceneNodeId: string): string {
  return `${projectId}:${sceneNodeId}`
}

/**
 * The one outgoing handle that represents the canonical linear line through a
 * chapter. Choices use their default / first option, conditions their first
 * branch (otherwise the else handle). Everything else is a branch segment.
 */
function primaryHandle(node: StoryNode): string {
  if (node.kind === 'choice') return node.defaultOptionId ?? node.options[0]?.id ?? STORY_OUTPUT_HANDLE
  if (node.kind === 'condition') return node.branches[0]?.id ?? STORY_ELSE_HANDLE
  return STORY_OUTPUT_HANDLE
}

/** Scene ids on the canonical path, in story order, starting from the first entry. */
export function mainlineSceneIds(chapter: StoryChapterGraph, preferredEntryId?: string | null): string[] {
  const entries = chapter.nodes.filter((node) => node.kind === 'entry')
  const entry = (preferredEntryId ? entries.find((node) => node.id === preferredEntryId) : null) ?? entries[0]
  if (!entry) return []
  const byId = new Map<string, StoryNode>(chapter.nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, StoryFlow[]>()
  for (const flow of chapter.flows) {
    const list = outgoing.get(flow.from)
    if (list) list.push(flow)
    else outgoing.set(flow.from, [flow])
  }
  const scenes: string[] = []
  const visited = new Set<string>()
  let current: StoryNode | undefined = entry
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.kind === 'scene') scenes.push(current.id)
    if (current.kind === 'exit' || current.kind === 'ending') break
    const flows: StoryFlow[] = outgoing.get(current.id) ?? []
    const primary: string = primaryHandle(current)
    const nextFlow: StoryFlow | undefined = flows.find((flow) => flow.handle === primary)
      ?? (current.kind === 'choice'
        ? flows[0]
        : current.kind === 'condition'
          ? flows.find((flow) => flow.handle === STORY_ELSE_HANDLE) ?? flows[0]
          : flows.find((flow) => flow.handle === STORY_OUTPUT_HANDLE) ?? flows[0])
    current = nextFlow ? byId.get(nextFlow.to) : undefined
  }
  return scenes
}

/** Config chapters sorted exactly the way the story map shows them. */
export function orderedChapters(metas: StoryChapterMeta[], chapters: StoryChapterGraph[]): StoryChapterGraph[] {
  const byId = new Map<string, StoryChapterGraph>()
  for (const chapter of chapters) byId.set(chapter.projectId, chapter)
  const ordered: StoryChapterGraph[] = []
  const used = new Set<string>()
  for (const meta of [...metas].sort((a, b) => a.order - b.order)) {
    const chapter = byId.get(meta.projectId)
    if (!chapter || used.has(chapter.projectId)) continue
    used.add(chapter.projectId)
    ordered.push(chapter)
  }
  for (const chapter of chapters) {
    if (used.has(chapter.projectId)) continue
    used.add(chapter.projectId)
    ordered.push(chapter)
  }
  return ordered
}

/**
 * Migration for configs written before the work canvas existed: every scene is
 * kept. Scenes on the canonical line become linear segments; all other scenes
 * become branch segments instead of being deleted or silently folded in.
 */
export function deriveStorySequence(metas: StoryChapterMeta[], chapters: StoryChapterGraph[]): StorySequence {
  const linear: StorySequenceSegment[] = []
  const branch: StorySequenceSegment[] = []
  for (const chapter of orderedChapters(metas, chapters)) {
    const path = mainlineSceneIds(chapter)
    const onPath = new Set(path)
    const sceneById = new Map(chapter.nodes.flatMap((node) => (node.kind === 'scene' ? [[node.id, node] as const] : [])))
    for (const sceneId of path) {
      const scene = sceneById.get(sceneId)
      if (!scene) continue
      linear.push({
        id: sequenceSegmentId(chapter.projectId, scene.id),
        projectId: chapter.projectId,
        sceneNodeId: scene.id,
        title: sceneTitle(scene),
        branch: false,
        removed: false,
      })
    }
    for (const node of chapter.nodes) {
      if (node.kind !== 'scene' || onPath.has(node.id)) continue
      branch.push({
        id: sequenceSegmentId(chapter.projectId, node.id),
        projectId: chapter.projectId,
        sceneNodeId: node.id,
        title: sceneTitle(node),
        branch: true,
        removed: false,
      })
    }
  }
  return { segments: [...linear, ...branch] }
}

function sceneIndex(metas: StoryChapterMeta[], chapters: StoryChapterGraph[]) {
  const index = new Map<string, StorySceneNode>()
  for (const chapter of orderedChapters(metas, chapters)) {
    for (const node of chapter.nodes) {
      if (node.kind === 'scene') index.set(sequenceSegmentKey(chapter.projectId, node.id), node)
    }
  }
  return index
}

function insertMissingSegments(
  existing: StorySequenceSegment[],
  derived: StorySequence,
  knownKeys: Set<string>,
): StorySequenceSegment[] {
  const result = [...existing]
  for (const candidate of derived.segments) {
    const key = sequenceSegmentKey(candidate.projectId, candidate.sceneNodeId)
    if (knownKeys.has(key)) continue
    knownKeys.add(key)
    let insertAt = result.length
    for (let index = result.length - 1; index >= 0; index -= 1) {
      if (result[index].projectId === candidate.projectId) {
        insertAt = index + 1
        break
      }
    }
    result.splice(insertAt, 0, candidate)
  }
  return result
}

/**
 * Makes a stored or missing sequence match the live chapter graphs while
 * preserving the user's order, removals and any orphaned references. Branch
 * status and titles are recomputed from the graph so a client cannot promote a
 * branch scene into the linear cut just by editing config JSON.
 */
export function ensureStorySequence(
  config: { chapters: StoryChapterMeta[] },
  chapters: StoryChapterGraph[],
  sequence?: StorySequence,
): StorySequence {
  const derived = deriveStorySequence(config.chapters, chapters)
  if (!sequence) return derived
  const scenes = sceneIndex(config.chapters, chapters)
  const derivedLinearKeys = new Set(derived.segments.filter((item) => !item.branch).map((item) => sequenceSegmentKey(item.projectId, item.sceneNodeId)))
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()
  const existing: StorySequenceSegment[] = []
  for (const segment of sequence.segments) {
    if (seenIds.has(segment.id)) continue
    const key = sequenceSegmentKey(segment.projectId, segment.sceneNodeId)
    if (seenKeys.has(key)) continue
    seenIds.add(segment.id)
    seenKeys.add(key)
    const scene = scenes.get(key)
    existing.push(scene ? { ...segment, title: sceneTitle(scene), branch: !derivedLinearKeys.has(key) } : segment)
  }
  return { segments: insertMissingSegments(existing, derived, seenKeys) }
}

/** Joins configured segments with the compiled story graph and resolved media. */
export function resolveSequenceSegments(sequence: StorySequence, chapters: WorkSequenceChapter[]): ResolvedSequenceSegment[] {
  const chapterById = new Map(chapters.map((chapter) => [chapter.projectId, chapter]))
  const sceneByKey = new Map<string, StorySceneNode>()
  for (const chapter of chapters) {
    for (const node of chapter.graph.nodes) {
      if (node.kind === 'scene') sceneByKey.set(sequenceSegmentKey(chapter.projectId, node.id), node)
    }
  }
  return sequence.segments.map((segment) => {
    const chapter = chapterById.get(segment.projectId)
    if (!chapter) {
      return { segment, chapterName: '', canvasId: null, scene: null, media: null, orphan: 'project' }
    }
    const scene = sceneByKey.get(sequenceSegmentKey(segment.projectId, segment.sceneNodeId)) ?? null
    if (!scene) {
      return { segment, chapterName: chapter.name, canvasId: chapter.canvasId, scene: null, media: null, orphan: 'scene' }
    }
    return { segment, chapterName: chapter.name, canvasId: chapter.canvasId, scene, media: scene.media, orphan: null }
  })
}

export function isCutSegment(item: ResolvedSequenceSegment): boolean {
  return !item.segment.branch && !item.segment.removed && item.orphan === null
}

/** The linear final cut: branch, removed and orphaned segments never enter it. */
export function linearCutSegments(items: ResolvedSequenceSegment[]): ResolvedSequenceSegment[] {
  return items.filter(isCutSegment)
}

export function branchSequenceSegments(items: ResolvedSequenceSegment[]): ResolvedSequenceSegment[] {
  return items.filter((item) => item.segment.branch || item.orphan !== null)
}

export function removedSequenceSegments(items: ResolvedSequenceSegment[]): ResolvedSequenceSegment[] {
  return items.filter((item) => item.segment.removed && !item.segment.branch && item.orphan === null)
}

export function orphanSequenceSegments(items: ResolvedSequenceSegment[]): ResolvedSequenceSegment[] {
  return items.filter((item) => item.orphan !== null)
}

export function sequenceStats(items: ResolvedSequenceSegment[]): SequenceStats {
  const cut = linearCutSegments(items)
  return {
    total: items.length,
    linear: items.filter((item) => !item.segment.branch && !item.orphan).length,
    cut: cut.length,
    branch: items.filter((item) => item.segment.branch && !item.orphan).length,
    removed: removedSequenceSegments(items).length,
    orphaned: orphanSequenceSegments(items).length,
    ready: cut.filter((item) => item.media !== null).length,
  }
}

/** Reorders only the ids the caller owns (normally the linear cut), leaving every other slot in place. */
export function reorderSequenceSegments(segments: StorySequenceSegment[], orderedIds: string[]): StorySequenceSegment[] {
  const byId = new Map(segments.map((segment) => [segment.id, segment]))
  const valid = orderedIds.filter((id, index) => byId.has(id) && orderedIds.indexOf(id) === index)
  if (!valid.length) return segments
  const movable = new Set(valid)
  const positions = segments.flatMap((segment, index) => (movable.has(segment.id) ? [index] : []))
  if (positions.length !== valid.length) return segments
  const result = [...segments]
  positions.forEach((position, index) => { result[position] = byId.get(valid[index]) as StorySequenceSegment })
  return result
}

export function moveSequenceSegment(
  segments: StorySequenceSegment[],
  id: string,
  direction: -1 | 1,
  movableIds: string[],
): StorySequenceSegment[] {
  const index = movableIds.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= movableIds.length) return segments
  const next = [...movableIds]
  ;[next[index], next[target]] = [next[target], next[index]]
  return reorderSequenceSegments(segments, next)
}
