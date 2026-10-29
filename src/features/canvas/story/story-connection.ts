import { isStoryNodeType, readChoiceData, readConditionData } from '@/lib/interactive/compile'
import { STORY_ELSE_HANDLE, STORY_FLOW_ROLE, STORY_OUTPUT_HANDLE } from '@/lib/interactive/types'
import type { CanvasConnectionInput, CanvasFlowEdge, CanvasFlowNode } from '../editor-types'

export const STORY_MEDIA_SOURCE_TYPES = new Set(['video', 'image', 'production_video', 'production_panel'])
/** A scene's top port: its picture comes in here, separate from the left-to-right story flow. */
export const STORY_MEDIA_HANDLE = 'media'

export type StoryConnectionPlan =
  | { kind: 'not_story' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'flow'; source: string; sourceHandle: string; target: string }
  | { kind: 'media'; source: string; target: string }

const isLeft = (handle: string | null | undefined) => handle === 'input' || handle === 'left'

/** Handles a story node can start a flow from; empty for nodes without outputs. */
export function storySourceHandles(node: { type?: string; data?: unknown }): string[] {
  switch (node.type) {
    case 'story_entry':
    case 'story_scene':
      return [STORY_OUTPUT_HANDLE]
    case 'story_choice':
      return readChoiceData(node.data).options.map((option) => option.id)
    case 'story_condition':
      return [...readConditionData(node.data).branches.map((branch) => branch.id), STORY_ELSE_HANDLE]
    default:
      return []
  }
}

/**
 * Story wiring keeps the exact right-side handle (option / branch / else) instead of
 * collapsing it to "output" like media wires, and allows loops back to earlier scenes.
 */
export function resolveStoryConnection(input: CanvasConnectionInput, nodes: readonly CanvasFlowNode[]): StoryConnectionPlan {
  if (!input.source || !input.target) return { kind: 'not_story' }
  const a = nodes.find((node) => node.id === input.source)
  const b = nodes.find((node) => node.id === input.target)
  if (!a || !b) return { kind: 'not_story' }
  if (!isStoryNodeType(a.type) && !isStoryNodeType(b.type)) return { kind: 'not_story' }
  if (a.id === b.id) return { kind: 'invalid', reason: '不能连接到自身' }
  if (input.sourceHandle === STORY_MEDIA_HANDLE || input.targetHandle === STORY_MEDIA_HANDLE) {
    const [scene, media] = input.targetHandle === STORY_MEDIA_HANDLE ? [b, a] : [a, b]
    if (scene.type === 'story_scene' && STORY_MEDIA_SOURCE_TYPES.has(media.type || '')) return { kind: 'media', source: media.id, target: scene.id }
    return { kind: 'invalid', reason: '片段顶部的画面接口只能连接视频或图片节点' }
  }
  if (isLeft(input.sourceHandle) === isLeft(input.targetHandle ?? 'input')) {
    return { kind: 'invalid', reason: '请从节点右侧连到另一个节点左侧' }
  }
  const [from, fromHandle, to] = isLeft(input.sourceHandle)
    ? [b, input.targetHandle || STORY_OUTPUT_HANDLE, a]
    : [a, input.sourceHandle || STORY_OUTPUT_HANDLE, b]

  if (!isStoryNodeType(from.type)) {
    if (to.type === 'story_scene' && STORY_MEDIA_SOURCE_TYPES.has(from.type || '')) return { kind: 'media', source: from.id, target: to.id }
    return { kind: 'invalid', reason: '只有视频或图片可以连到剧情片段作为画面' }
  }
  if (!isStoryNodeType(to.type)) return { kind: 'invalid', reason: '剧情节点只能连接剧情节点' }
  if (to.type === 'story_entry') return { kind: 'invalid', reason: '入口不能被连入；跨章节请在故事总览连线' }
  const handles = storySourceHandles(from)
  if (!handles.length) return { kind: 'invalid', reason: '出口和结局之后不能再连接' }
  if (!handles.includes(fromHandle)) {
    return { kind: 'invalid', reason: from.type === 'story_condition' ? '请从具体分支右侧的连接点拖出' : '请从具体选项右侧的连接点拖出' }
  }
  return { kind: 'flow', source: from.id, sourceHandle: fromHandle, target: to.id }
}

/** Returns the next edge list, or null when nothing changes. A handle keeps one outgoing flow and a scene one picture. */
export function applyStoryConnection(
  edges: readonly CanvasFlowEdge[],
  plan: Extract<StoryConnectionPlan, { kind: 'flow' | 'media' }>,
  createId: () => string,
): CanvasFlowEdge[] | null {
  if (plan.kind === 'media') {
    const intoScene = (edge: CanvasFlowEdge) => edge.target === plan.target && edge.data?.role !== STORY_FLOW_ROLE
    if (edges.some((edge) => intoScene(edge) && edge.source === plan.source)) return null
    return [
      ...edges.filter((edge) => !intoScene(edge)),
      { id: createId(), source: plan.source, target: plan.target, sourceHandle: 'output', targetHandle: STORY_MEDIA_HANDLE, type: 'bezier', data: { role: 'REF' } },
    ]
  }
  const sameHandle = (edge: CanvasFlowEdge) => edge.source === plan.source && (edge.sourceHandle || STORY_OUTPUT_HANDLE) === plan.sourceHandle && edge.data?.role === STORY_FLOW_ROLE
  if (edges.some((edge) => sameHandle(edge) && edge.target === plan.target)) return null
  return [
    ...edges.filter((edge) => !sameHandle(edge)),
    { id: createId(), source: plan.source, target: plan.target, sourceHandle: plan.sourceHandle, targetHandle: 'input', type: 'bezier', data: { role: STORY_FLOW_ROLE } },
  ]
}

/** Drops story flows whose source handle no longer exists (deleted option / branch). */
export function pruneStoryFlows(edges: readonly CanvasFlowEdge[], node: Pick<CanvasFlowNode, 'id' | 'type' | 'data'>): CanvasFlowEdge[] {
  if (!isStoryNodeType(node.type)) return edges as CanvasFlowEdge[]
  const handles = new Set(storySourceHandles(node))
  const next = edges.filter((edge) => edge.source !== node.id || edge.data?.role !== STORY_FLOW_ROLE || handles.has(edge.sourceHandle || STORY_OUTPUT_HANDLE))
  return next.length === edges.length ? edges as CanvasFlowEdge[] : next
}
