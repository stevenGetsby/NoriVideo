import { isStoryNodeType, readChoiceData, readConditionData } from '@/lib/interactive/compile'
import { interactionHandles, readInteractionData } from '@/lib/interactive/interaction'
import {
  STORY_ELSE_HANDLE,
  STORY_FLOW_ROLE,
  STORY_INTERACT_HANDLE,
  STORY_MOUNT_HANDLE,
  STORY_MOUNT_ROLE,
  STORY_OUTPUT_HANDLE,
  STORY_TIMEOUT_HANDLE,
} from '@/lib/interactive/types'
import type { CanvasConnectionInput, CanvasFlowEdge, CanvasFlowNode } from '../editor-types'

export const STORY_MEDIA_SOURCE_TYPES = new Set(['video', 'image', 'production_video', 'production_panel'])
/** 可以接「画面」口的节点：片段（制作层画面）、互动节点与限时抉择（独立停靠点的底图）。 */
export const STORY_MEDIA_TARGET_TYPES = new Set(['story_scene', 'story_interaction', 'story_choice'])
export const isStoryMediaTarget = (type: string | null | undefined) => STORY_MEDIA_TARGET_TYPES.has(type ?? '')
/** A story card's top picture port: the picture comes in here, separate from the left-to-right story flow. */
export const STORY_MEDIA_HANDLE = 'media'

export type StoryConnectionPlan =
  | { kind: 'not_story' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'flow'; source: string; sourceHandle: string; target: string }
  | { kind: 'media'; source: string; target: string }
  /** An interaction hung on a scene's bottom port: it plays inside the scene's video. */
  | { kind: 'mount'; source: string; target: string }

export type StoryLinkPlan = Extract<StoryConnectionPlan, { kind: 'flow' | 'media' | 'mount' }>

const isLeft = (handle: string | null | undefined) => handle === 'input' || handle === 'left'
const isMountEdge = (edge: CanvasFlowEdge) => edge.data?.role === STORY_MOUNT_ROLE

/** Handles a story node can start a flow from; empty for nodes without outputs. */
export function storySourceHandles(node: { type?: string; data?: unknown }): string[] {
  switch (node.type) {
    case 'story_entry':
    case 'story_scene':
      return [STORY_OUTPUT_HANDLE]
    case 'story_choice': {
      const choice = readChoiceData(node.data)
      return [...choice.options.map((option) => option.id), ...(choice.timeoutSec && choice.timeoutMode === 'exit' ? [STORY_TIMEOUT_HANDLE] : [])]
    }
    case 'story_condition':
      return [...readConditionData(node.data).branches.map((branch) => branch.id), STORY_ELSE_HANDLE]
    case 'story_interaction':
      return interactionHandles(readInteractionData(node.data).spec)
    default:
      return []
  }
}

/** Mounting pairs a scene's bottom port with an interaction's top port, whichever one the wire was pulled from. */
function resolveMount(input: CanvasConnectionInput, a: CanvasFlowNode, b: CanvasFlowNode): StoryConnectionPlan {
  const sceneIsSource = input.sourceHandle === STORY_INTERACT_HANDLE || input.targetHandle === STORY_MOUNT_HANDLE
  const [scene, interaction] = sceneIsSource ? [a, b] : [b, a]
  if (scene.type !== 'story_scene') return { kind: 'invalid', reason: '互动要挂在剧情片段底部的互动口上' }
  if (interaction.type !== 'story_interaction') return { kind: 'invalid', reason: '片段底部的互动口只能连接互动节点（含「限时抉择」）' }
  return { kind: 'mount', source: scene.id, target: interaction.id }
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
  if ([input.sourceHandle, input.targetHandle].some((handle) => handle === STORY_INTERACT_HANDLE || handle === STORY_MOUNT_HANDLE)) {
    return resolveMount(input, a, b)
  }
  if (input.sourceHandle === STORY_MEDIA_HANDLE || input.targetHandle === STORY_MEDIA_HANDLE) {
    const [host, media] = input.targetHandle === STORY_MEDIA_HANDLE ? [b, a] : [a, b]
    if (isStoryMediaTarget(host.type) && STORY_MEDIA_SOURCE_TYPES.has(media.type || '')) return { kind: 'media', source: media.id, target: host.id }
    return { kind: 'invalid', reason: '画面接口只能连接视频或图片节点' }
  }
  if (isLeft(input.sourceHandle) === isLeft(input.targetHandle ?? 'input')) {
    return { kind: 'invalid', reason: '请从节点右侧连到另一个节点左侧' }
  }
  const [from, fromHandle, to] = isLeft(input.sourceHandle)
    ? [b, input.targetHandle || STORY_OUTPUT_HANDLE, a]
    : [a, input.sourceHandle || STORY_OUTPUT_HANDLE, b]

  if (!isStoryNodeType(from.type)) {
    if (isStoryMediaTarget(to.type) && STORY_MEDIA_SOURCE_TYPES.has(from.type || '')) return { kind: 'media', source: from.id, target: to.id }
    return { kind: 'invalid', reason: '只有视频或图片可以连接为画面' }
  }
  if (!isStoryNodeType(to.type)) return { kind: 'invalid', reason: '剧情节点只能连接剧情节点' }
  if (to.type === 'story_entry') return { kind: 'invalid', reason: '入口不能被连入；跨章节请在故事总览连线' }
  const handles = storySourceHandles(from)
  if (!handles.length) return { kind: 'invalid', reason: '出口和结局之后不能再连接' }
  if (!handles.includes(fromHandle)) {
    return { kind: 'invalid', reason: from.type === 'story_condition' ? '请从具体分支右侧的连接点拖出' : from.type === 'story_interaction' ? '请从具体结果右侧的连接点拖出' : '请从具体选项右侧的连接点拖出' }
  }
  return { kind: 'flow', source: from.id, sourceHandle: fromHandle, target: to.id }
}

/**
 * Returns the next edge list, or null when nothing changes. A handle keeps one outgoing flow, a picture
 * port one media wire, and an interaction is either mounted on one scene or wired into the story flow, never both.
 */
export function applyStoryConnection(
  edges: readonly CanvasFlowEdge[],
  plan: StoryLinkPlan,
  createId: () => string,
): CanvasFlowEdge[] | null {
  if (plan.kind === 'media') {
    const intoTarget = (edge: CanvasFlowEdge) => edge.target === plan.target && edge.data?.role !== STORY_FLOW_ROLE && !isMountEdge(edge)
    if (edges.some((edge) => intoTarget(edge) && edge.source === plan.source)) return null
    return [
      ...edges.filter((edge) => !intoTarget(edge)),
      { id: createId(), source: plan.source, target: plan.target, sourceHandle: 'output', targetHandle: STORY_MEDIA_HANDLE, type: 'bezier', data: { role: 'REF' } },
    ]
  }
  if (plan.kind === 'mount') {
    if (edges.some((edge) => isMountEdge(edge) && edge.source === plan.source && edge.target === plan.target)) return null
    const intoInteraction = (edge: CanvasFlowEdge) => edge.target === plan.target && (isMountEdge(edge) || edge.data?.role === STORY_FLOW_ROLE)
    return [
      ...edges.filter((edge) => !intoInteraction(edge)),
      { id: createId(), source: plan.source, target: plan.target, sourceHandle: STORY_INTERACT_HANDLE, targetHandle: STORY_MOUNT_HANDLE, type: 'bezier', data: { role: STORY_MOUNT_ROLE } },
    ]
  }
  const sameHandle = (edge: CanvasFlowEdge) => edge.source === plan.source && (edge.sourceHandle || STORY_OUTPUT_HANDLE) === plan.sourceHandle && edge.data?.role === STORY_FLOW_ROLE
  if (edges.some((edge) => sameHandle(edge) && edge.target === plan.target)) return null
  const unmount = (edge: CanvasFlowEdge) => isMountEdge(edge) && edge.target === plan.target
  return [
    ...edges.filter((edge) => !sameHandle(edge) && !unmount(edge)),
    { id: createId(), source: plan.source, target: plan.target, sourceHandle: plan.sourceHandle, targetHandle: 'input', type: 'bezier', data: { role: STORY_FLOW_ROLE } },
  ]
}

/** Why a connection replaced something, phrased for the toast; null when it only added a wire. */
export function storyReplaceNotice(before: readonly CanvasFlowEdge[], after: readonly CanvasFlowEdge[], plan: StoryLinkPlan): string | null {
  if (after.length > before.length) return null
  if (plan.kind === 'media') return '已替换画面'
  if (plan.kind === 'mount') {
    return before.some((edge) => edge.target === plan.target && edge.data?.role === STORY_FLOW_ROLE)
      ? '互动已从剧情连线上取下，改为挂在这个片段上'
      : '已改挂到这个片段'
  }
  return before.some((edge) => isMountEdge(edge) && edge.target === plan.target)
    ? '互动已从片段上取下，改为接在剧情线上'
    : '已改连：每个出口只保留一条剧情线'
}

/** Drops story flows whose source handle no longer exists (deleted option / branch / result). */
export function pruneStoryFlows(edges: readonly CanvasFlowEdge[], node: Pick<CanvasFlowNode, 'id' | 'type' | 'data'>): CanvasFlowEdge[] {
  if (!isStoryNodeType(node.type)) return edges as CanvasFlowEdge[]
  const handles = new Set(storySourceHandles(node))
  const next = edges.filter((edge) => edge.source !== node.id || edge.data?.role !== STORY_FLOW_ROLE || handles.has(edge.sourceHandle || STORY_OUTPUT_HANDLE))
  return next.length === edges.length ? edges as CanvasFlowEdge[] : next
}

/** Node data keys whose change can add or remove result ports, so wires must be re-checked. */
export const STORY_HANDLE_PATCH_KEYS = ['options', 'branches', 'interaction', 'timeoutSec', 'timeoutMode'] as const
