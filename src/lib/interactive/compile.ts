import {
  STORY_COMPARE_OPS,
  STORY_ENDING_TYPES,
  STORY_FLOW_ROLE,
  STORY_NODE_TYPES,
  STORY_OUTPUT_HANDLE,
  type StoryChapterGraph,
  type StoryChoiceOption,
  type StoryCompareOp,
  type StoryCondition,
  type StoryConditionBranch,
  type StoryEffect,
  type StoryEndingType,
  type StoryFlow,
  type StoryMedia,
  type StoryNode,
  type StoryNodeKind,
  type StoryNodeType,
  type StoryValue,
} from './types'

export interface CanvasNodeLike { id: string; type: string; data?: unknown }
export interface CanvasEdgeLike { id: string; source: string; target: string; sourceHandle?: string | null; role?: string | null }

export const STORY_KIND_BY_TYPE: Record<StoryNodeType, StoryNodeKind> = {
  story_entry: 'entry',
  story_scene: 'scene',
  story_choice: 'choice',
  story_condition: 'condition',
  story_exit: 'exit',
  story_ending: 'ending',
}

export const STORY_KIND_LABEL: Record<StoryNodeKind, string> = {
  entry: '入口',
  scene: '剧情片段',
  choice: '选择',
  condition: '条件',
  exit: '出口',
  ending: '结局',
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

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const id = (value: unknown) => (typeof value === 'string' && value ? value : null)
const storyValue = (value: unknown): StoryValue => (typeof value === 'boolean' ? value : Number.isFinite(value) ? value as number : 0)

export function readStoryEffects(raw: unknown): StoryEffect[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const effect = record(item)
    const variableId = id(effect.variableId)
    if (!variableId) return []
    return [{ variableId, op: effect.op === 'add' ? 'add' : 'set', value: storyValue(effect.value) } satisfies StoryEffect]
  })
}

export function readStoryConditions(raw: unknown): StoryCondition[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const condition = record(item)
    const variableId = id(condition.variableId)
    if (!variableId) return []
    const op = STORY_COMPARE_OPS.includes(condition.op as StoryCompareOp) ? condition.op as StoryCompareOp : '=='
    return [{ variableId, op, value: storyValue(condition.value) }]
  })
}

export function readChoiceData(raw: unknown) {
  const data = record(raw)
  const options: StoryChoiceOption[] = (Array.isArray(data.options) ? data.options : []).flatMap((item) => {
    const option = record(item)
    const optionId = id(option.id)
    return optionId ? [{ id: optionId, label: text(option.label), effects: readStoryEffects(option.effects) }] : []
  })
  const timeout = Number(data.timeoutSec)
  const defaultOptionId = id(data.defaultOptionId)
  return {
    prompt: text(data.prompt),
    options,
    timeoutSec: Number.isFinite(timeout) && timeout > 0 ? Math.min(Math.round(timeout), 120) : null,
    defaultOptionId: defaultOptionId && options.some((o) => o.id === defaultOptionId) ? defaultOptionId : null,
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
  return { endingType, description: text(data.description) }
}

export function readSceneData(raw: unknown) {
  const data = record(raw)
  return {
    lines: text(data.lines),
    videoUrl: id(data.videoUrl),
    imageUrl: id(data.imageUrl),
    posterUrl: id(data.posterUrl),
    effects: readStoryEffects(data.effects),
  }
}

function mediaFromNode(node: CanvasNodeLike): StoryMedia | null {
  const data = record(node.data)
  const poster = id(data.posterUrl) ?? id(data.imageUrl)
  if (node.type === 'video' || node.type === 'production_video') {
    const url = id(data.videoUrl) ?? id(data.contentUrl)
    if (url) return { kind: 'video', url, posterUrl: poster }
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
  if (scene.videoUrl) return { kind: 'video', url: scene.videoUrl, posterUrl: scene.posterUrl ?? scene.imageUrl }
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
      return { id: node.id, kind, title, lines: scene.lines, effects: scene.effects, media: resolveSceneMedia(node.id, node.data, nodes, edges) }
    }
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
