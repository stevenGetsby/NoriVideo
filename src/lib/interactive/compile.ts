import {
  STORY_ENDING_TYPES,
  STORY_FLOW_ROLE,
  STORY_MOUNT_ROLE,
  STORY_NODE_TYPES,
  STORY_OUTPUT_HANDLE,
  type StoryChapterGraph,
  type StoryConditionBranch,
  type StoryEndingType,
  type StoryFlow,
  type StoryInteractionNode,
  type StoryMedia,
  type StoryNode,
  type StoryNodeKind,
  type StoryNodeType,
  type StorySavePoint,
} from './types'
import { readChoiceOptions, readChoicePresentation, readInteractionData } from './interaction'
import { id, readStoryConditions, readStoryEffects, record, text } from './read'
import { normalizeSceneText } from './scene-text'

export interface CanvasNodeLike { id: string; type: string; data?: unknown }
export interface CanvasEdgeLike { id: string; source: string; target: string; sourceHandle?: string | null; role?: string | null }

export const STORY_KIND_BY_TYPE: Record<StoryNodeType, StoryNodeKind> = {
  story_entry: 'entry',
  story_scene: 'scene',
  story_choice: 'choice',
  story_condition: 'condition',
  story_exit: 'exit',
  story_ending: 'ending',
  story_interaction: 'interaction',
}

export const STORY_KIND_LABEL: Record<StoryNodeKind, string> = {
  entry: '入口',
  scene: '剧情片段',
  choice: '选择',
  condition: '条件',
  exit: '出口',
  ending: '结局',
  interaction: '互动',
}

export const STORY_ENDING_LABEL: Record<StoryEndingType, string> = {
  good: '好结局',
  normal: '普通结局',
  bad: '坏结局',
  hidden: '隐藏结局',
}

export function isStoryNodeType(type: unknown): type is StoryNodeType {
  return STORY_NODE_TYPES.includes(type as StoryNodeType)
}

export function readChoiceData(raw: unknown) {
  const data = record(raw)
  const options = readChoiceOptions(data.options)
  const timeout = Number(data.timeoutSec)
  const defaultOptionId = id(data.defaultOptionId)
  return {
    prompt: text(data.prompt),
    options,
    timeoutSec: Number.isFinite(timeout) && timeout > 0 ? Math.min(Math.round(timeout), 120) : null,
    defaultOptionId: defaultOptionId && options.some((o) => o.id === defaultOptionId) ? defaultOptionId : null,
    ...readChoicePresentation(data),
  }
}

export function readConditionData(raw: unknown) {
  const data = record(raw)
  const branches: StoryConditionBranch[] = (Array.isArray(data.branches) ? data.branches : []).flatMap((item) => {
    const branch = record(item)
    const branchId = id(branch.id)
    if (!branchId) return []
    return [{
      id: branchId,
      label: text(branch.label),
      match: branch.match === 'any' ? 'any' : 'all',
      conditions: readStoryConditions(branch.conditions),
    } satisfies StoryConditionBranch]
  })
  return { branches }
}

export function readEndingData(raw: unknown) {
  const data = record(raw)
  const endingType = STORY_ENDING_TYPES.includes(data.endingType as StoryEndingType) ? data.endingType as StoryEndingType : 'normal'
  return { endingType, description: text(data.description), ...(data.showPersonality === true ? { showPersonality: true } : {}) }
}

export const STORY_SAVE_POINT_NAME_MAX = 24

/** A segment is a save point only while the creator keeps it ticked; the name is optional, the caller supplies a fallback. */
export function readSavePoint(raw: unknown, fallbackName = ''): StorySavePoint | undefined {
  const data = record(raw)
  if (data.enabled !== true) return undefined
  return { name: text(data.name).trim().slice(0, STORY_SAVE_POINT_NAME_MAX) || fallbackName, coverUrl: id(data.coverUrl) }
}

export function readSceneData(raw: unknown) {
  const data = record(raw)
  const savePoint = readSavePoint(data.savePoint)
  return {
    lines: normalizeSceneText(data.lines),
    videoUrl: id(data.videoUrl),
    videoDurationSec: positiveNumber(data.videoDurationSec),
    imageUrl: id(data.imageUrl),
    posterUrl: id(data.posterUrl),
    effects: readStoryEffects(data.effects),
    ...(savePoint ? { savePoint } : {}),
  }
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** Length of a video node in seconds, from whatever the canvas recorded about its source. */
function videoNodeDurationSec(data: Record<string, unknown>): number | undefined {
  const metadata = record(data.sourceMetadata)
  const ms = positiveNumber(metadata.durationMs)
  if (ms) return ms / 1000
  return positiveNumber(metadata.durationSeconds) ?? positiveNumber(data.videoDurationSec) ?? positiveNumber(record(data.generation).duration)
}

function mediaFromNode(node: CanvasNodeLike): StoryMedia | null {
  const data = record(node.data)
  const poster = id(data.posterUrl) ?? id(data.imageUrl)
  if (node.type === 'video' || node.type === 'production_video') {
    const url = id(data.videoUrl) ?? id(data.contentUrl)
    const durationSec = videoNodeDurationSec(data)
    if (url) return { kind: 'video', url, posterUrl: poster, ...(durationSec ? { durationSec } : {}) }
  }
  if (node.type === 'image' || node.type === 'production_panel') {
    const url = id(data.imageUrl) ?? id(data.contentUrl)
    if (url) return { kind: 'image', url, posterUrl: url }
  }
  return null
}

/** Scene media: own pick first, otherwise the first linked video, otherwise a linked image. */
export function resolveSceneMedia(sceneId: string, data: unknown, nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): StoryMedia | null {
  const scene = readSceneData(data)
  if (scene.videoUrl) {
    return { kind: 'video', url: scene.videoUrl, posterUrl: scene.posterUrl ?? scene.imageUrl, ...(scene.videoDurationSec ? { durationSec: scene.videoDurationSec } : {}) }
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const linked = edges
    .filter((edge) => edge.target === sceneId && edge.role !== STORY_FLOW_ROLE)
    .map((edge) => byId.get(edge.source))
    .flatMap((node) => (node ? [mediaFromNode(node)] : []))
    .filter((media): media is StoryMedia => !!media)
  const linkedMedia = linked.find((media) => media.kind === 'video') ?? linked[0]
  if (linkedMedia) return linkedMedia
  if (scene.imageUrl) return { kind: 'image', url: scene.imageUrl, posterUrl: scene.imageUrl }
  return null
}

/** The scene an interaction is mounted on, or null when it is wired into the flow instead. */
export function mountedSceneId(interactionId: string, nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): string | null {
  const edge = edges.find((item) => item.role === STORY_MOUNT_ROLE && item.target === interactionId)
  if (!edge) return null
  return nodes.find((node) => node.id === edge.source)?.type === 'story_scene' ? edge.source : null
}

function compileInteraction(node: CanvasNodeLike, mountedOn: string | null): StoryInteractionNode {
  return { id: node.id, kind: 'interaction', mountedOn, ...readInteractionData(node.data) }
}

export function compileStoryNode(node: CanvasNodeLike, nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): StoryNode | null {
  if (!isStoryNodeType(node.type)) return null
  const kind = STORY_KIND_BY_TYPE[node.type]
  const title = text(record(node.data).title).trim() || STORY_KIND_LABEL[kind]
  switch (kind) {
    case 'entry':
    case 'exit':
      return { id: node.id, kind, title }
    case 'scene': {
      const scene = readSceneData(node.data)
      const beats = nodes
        .filter((item) => item.type === 'story_interaction' && mountedSceneId(item.id, nodes, edges) === node.id)
        .map((item) => compileInteraction(item, node.id))
        .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
      const savePoint = readSavePoint(record(node.data).savePoint, title)
      return {
        id: node.id,
        kind,
        title,
        lines: scene.lines,
        effects: scene.effects,
        media: resolveSceneMedia(node.id, node.data, nodes, edges),
        beats,
        ...(savePoint ? { savePoint } : {}),
      }
    }
    case 'interaction':
      return compileInteraction(node, mountedSceneId(node.id, nodes, edges))
    case 'choice':
      return { id: node.id, kind, title, ...readChoiceData(node.data) }
    case 'condition':
      return { id: node.id, kind, title, ...readConditionData(node.data) }
    case 'ending':
      return { id: node.id, kind, title, ...readEndingData(node.data) }
  }
}

export function compileChapter(
  chapter: { projectId: string; title: string },
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
): StoryChapterGraph {
  const storyNodes = nodes.map((node) => compileStoryNode(node, nodes, edges)).filter((node): node is StoryNode => !!node)
  const storyIds = new Set(storyNodes.map((node) => node.id))
  const flows: StoryFlow[] = edges
    .filter((edge) => edge.role === STORY_FLOW_ROLE && storyIds.has(edge.source) && storyIds.has(edge.target))
    .map((edge) => ({ id: edge.id, from: edge.source, handle: edge.sourceHandle || STORY_OUTPUT_HANDLE, to: edge.target }))
  return { projectId: chapter.projectId, title: chapter.title, nodes: storyNodes, flows }
}
