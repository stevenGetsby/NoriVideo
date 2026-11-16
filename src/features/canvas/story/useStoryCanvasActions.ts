'use client'

import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type { ReactFlowInstance, ReactFlowState } from '@xyflow/react'
import { isStoryNodeType, readChoiceData } from '@/lib/interactive/compile'
import { defaultInteractionData, interactionHandleLabel, readInteractionData, retargetHandleMap, retargetInteractionData, STORY_INTERACTION_LABEL } from '@/lib/interactive/interaction'
import { STORY_FLOW_ROLE, STORY_INTERACT_HANDLE, STORY_MOUNT_HANDLE, STORY_OUTPUT_HANDLE, type StoryInteractionKind } from '@/lib/interactive/types'
import { confirmAction } from '@/lib/ui/feedback'
import { canvasGroupIdsContainingMembers, fitCanvasGroupsToMembers } from '../actions/layout'
import {
  createFlowNode,
  defaultCanvasNodeData,
  DEFAULT_NODE_SIZES,
  type CanvasConnectionInput,
  type CanvasFlowEdge,
  type CanvasFlowNode,
  type CanvasNodeMenuType,
  type CanvasWireMenuState,
} from '../editor-types'
import type { StoryCanvasActions, StoryCanvasState } from './StoryCanvasContext'
import { nextBeatStart } from './story-beats'
import { applyStoryConnection, isStoryMediaTarget, resolveStoryConnection, STORY_MEDIA_HANDLE, STORY_MEDIA_SOURCE_TYPES, storyReplaceNotice, storySourceHandles, type StoryConnectionPlan, type StoryLinkPlan } from './story-connection'
import { nodeBox, paneRenderedScale, resolveStoryWireTarget, storyHandleCenter, storyNodeAt, storyWireRole, type StoryPoint, type StoryWireRole } from './story-geometry'
import { removeChoiceOption } from './story-choice-edit'
import { layoutObstacles, layoutStoryChapter, nearestFreeSpot, revealOffset, roomAbove, storyDropBox, STORY_NEW_NODE_SIZES, type LayoutBox } from './story-layout'

type Ref<T> = { current: T }
type NodeData = Partial<CanvasFlowNode['data']>

export type StoryActionDeps = {
  story: StoryCanvasState | null
  writeLocked: boolean
  flow: ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge> | null
  flowStore: { getState: () => ReactFlowState<CanvasFlowNode, CanvasFlowEdge> }
  nodesRef: Ref<CanvasFlowNode[]>
  edgesRef: Ref<CanvasFlowEdge[]>
  setNodes: Dispatch<SetStateAction<CanvasFlowNode[]>>
  setEdges: Dispatch<SetStateAction<CanvasFlowEdge[]>>
  setWireMenu: Dispatch<SetStateAction<CanvasWireMenuState | null>>
  record: (label: string) => void
  markChanged: (label: string) => void
  ensureNodeCapacity: (additional: number) => boolean
  toast: (message: string) => void
  toFlowPoint: (client: StoryPoint) => StoryPoint
  animateNodeLayout: (build: (current: CanvasFlowNode[]) => CanvasFlowNode[], onComplete?: () => void) => void
  removeEdges: (edgeIds: string[]) => void
  maxEdges: number
}

export type StoryEditorActions = StoryCanvasActions & {
  /** Settles a released story wire: connect, explain the refusal, or offer what to create. False = not a story wire. */
  finishWire: (fromId: string, fromHandle: string | null | undefined, client: StoryPoint) => boolean
  /** Creates the node picked from a story wire menu, placed and wired in one undo step. False = ordinary pick. */
  pickWireNode: (menu: CanvasWireMenuState, type: CanvasNodeMenuType, interaction?: StoryInteractionKind) => boolean
  commit: (plan: StoryConnectionPlan) => void
  /** Top-left for a new node centred near `center` that keeps clear of existing cards. */
  placeNew: (type: CanvasNodeMenuType, center: StoryPoint) => StoryPoint
  /** Offset that puts copies of these nodes in the nearest clear rows beside the originals. */
  copyOffset: (nodeIds: readonly string[]) => StoryPoint
  /** Offset that keeps nodes about to be pasted at their positions clear of existing cards. */
  pasteOffset: (nodes: readonly CanvasFlowNode[]) => StoryPoint
}

const MEDIA_GAP = 72
const QUICK_ADD_REACH = 140
const QUICK_MOUNT_REACH = 72
const newId = () => crypto.randomUUID()
const isLinkPlan = (plan: StoryConnectionPlan | null): plan is StoryLinkPlan => plan?.kind === 'flow' || plan?.kind === 'media' || plan?.kind === 'mount'
const inside = (point: StoryPoint, box: LayoutBox) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height

export const newStoryNodeSize = (type: string) => STORY_NEW_NODE_SIZES[type] ?? DEFAULT_NODE_SIZES[type] ?? { width: 300, height: 200 }

/** The connection a node created from a released wire makes back to the wire's source. */
export function storyWireLink(role: StoryWireRole, fromId: string, fromHandle: string | null, node: { id: string; type?: string; data?: unknown }): CanvasConnectionInput {
  if (role === 'forward') return { source: fromId, sourceHandle: fromHandle || STORY_OUTPUT_HANDLE, target: node.id, targetHandle: 'input' }
  if (role === 'backward') return { source: node.id, sourceHandle: storySourceHandles(node)[0] ?? STORY_OUTPUT_HANDLE, target: fromId, targetHandle: 'input' }
  if (role === 'mount') return { source: fromId, sourceHandle: STORY_INTERACT_HANDLE, target: node.id, targetHandle: STORY_MOUNT_HANDLE }
  if (role === 'mount-pick') return { source: node.id, sourceHandle: STORY_INTERACT_HANDLE, target: fromId, targetHandle: STORY_MOUNT_HANDLE }
  if (role === 'media') return { source: fromId, sourceHandle: 'output', target: node.id, targetHandle: STORY_MEDIA_HANDLE }
  return { source: node.id, sourceHandle: 'output', target: fromId, targetHandle: STORY_MEDIA_HANDLE }
}

/** Why a story wire dropped on `hit` cannot connect, phrased as what to do instead. */
export function storyWireRefusal(role: StoryWireRole, fromId: string, fromHandle: string | null | undefined, hit: { id: string; type?: string }, nodes: readonly CanvasFlowNode[]): string {
  if (role === 'mount') return '片段底部的互动口只能连接互动节点（含「限时抉择」）'
  if (role === 'mount-pick') return '互动要挂在剧情片段底部的互动口上'
  if (role === 'media-pick') return '画面接口只能连接视频或图片节点'
  if (role === 'media' || STORY_MEDIA_SOURCE_TYPES.has(hit.type || '')) return '视频和图片只能作为画面，请连到片段或互动顶部的画面接口'
  if (!isStoryNodeType(hit.type)) return '剧情连线只能连接剧情节点'
  const plan = resolveStoryConnection(role === 'forward'
    ? { source: fromId, sourceHandle: fromHandle || STORY_OUTPUT_HANDLE, target: hit.id, targetHandle: 'input' }
    : { source: hit.id, sourceHandle: STORY_OUTPUT_HANDLE, target: fromId, targetHandle: 'input' }, nodes)
  return plan.kind === 'invalid' ? plan.reason : '这里无法连接'
}

export function createStoryActions(ref: Ref<StoryActionDeps>): StoryEditorActions {
  const deps = () => ref.current
  const flowState = () => ref.current.flowStore.getState()
  const paneScale = () => { const state = flowState(); return paneRenderedScale(state.domNode, state.width) }
  const freeSpot = (box: LayoutBox, upward = false) => nearestFreeSpot(box, layoutObstacles(flowState().nodeLookup.values()), { upward })

  const reveal = (box: LayoutBox) => {
    const state = flowState()
    const flow = deps().flow
    if (!flow || !state.width || !state.height) return
    const [x, y, zoom] = state.transform
    const offset = revealOffset(box, { x, y, zoom }, { width: state.width, height: state.height })
    if (offset.x || offset.y) void flow.setViewport({ x: x + offset.x, y: y + offset.y, zoom }, { duration: 260 })
  }

  const commit = (plan: StoryConnectionPlan) => {
    const d = deps()
    if (d.writeLocked || plan.kind === 'not_story') return
    if (plan.kind === 'invalid') { d.toast(plan.reason); return }
    const edges = d.edgesRef.current
    if (edges.length >= d.maxEdges) { d.toast('连线数量已达上限'); return }
    const next = applyStoryConnection(edges, plan, newId)
    if (!next) return
    d.record('添加剧情连线')
    d.edgesRef.current = next
    d.setEdges(next)
    d.markChanged('添加剧情连线')
    const notice = storyReplaceNotice(edges, next, plan)
    if (notice) d.toast(notice)
  }

  const insert = (type: CanvasNodeMenuType, position: StoryPoint, link?: (node: CanvasFlowNode) => CanvasConnectionInput, data?: NodeData, interaction?: StoryInteractionKind) => {
    const d = deps()
    if (d.writeLocked || !d.ensureNodeCapacity(1)) return false
    const node = createFlowNode(type, position, interaction)
    if (data) node.data = { ...node.data, ...data }
    const nodes = [...d.nodesRef.current.map((item) => (item.selected ? { ...item, selected: false } : item)), node]
    const edges = d.edgesRef.current
    const plan = link ? resolveStoryConnection(link(node), nodes) : null
    const linked = isLinkPlan(plan) && edges.length < d.maxEdges ? applyStoryConnection(edges, plan, newId) : null
    const label = linked ? '添加并连接节点' : '添加节点'
    d.record(label)
    d.nodesRef.current = nodes
    d.setNodes(nodes)
    if (linked) { d.edgesRef.current = linked; d.setEdges(linked) }
    d.markChanged(label)
    d.setWireMenu(null)
    if (plan?.kind === 'invalid') d.toast(plan.reason)
    else if (isLinkPlan(plan) && linked) {
      const notice = storyReplaceNotice(edges, linked, plan)
      if (notice) d.toast(notice)
    }
    reveal({ ...position, ...newStoryNodeSize(type) })
    return true
  }

  const moveDown = (nodeIds: readonly string[], dy: number, label: string) => {
    const moved = new Set(nodeIds)
    deps().animateNodeLayout(
      (current) => fitCanvasGroupsToMembers(
        current.map((node) => (moved.has(node.id) ? { ...node, position: { x: node.position.x, y: node.position.y + dy } } : node)),
        canvasGroupIdsContainingMembers(current, moved),
      ),
      () => deps().markChanged(label),
    )
  }

  /** One offset that moves a set of new cards into the nearest clear rows while keeping their arrangement. */
  const clearOffset = (boxes: readonly LayoutBox[]) => {
    if (!boxes.length) return { x: 0, y: 0 }
    const left = Math.min(...boxes.map((box) => box.x))
    const top = Math.min(...boxes.map((box) => box.y))
    const cluster = { x: left, y: top, width: Math.max(...boxes.map((box) => box.x + box.width)) - left, height: Math.max(...boxes.map((box) => box.y + box.height)) - top }
    const spot = freeSpot(cluster)
    reveal({ ...cluster, ...spot })
    return { x: spot.x - cluster.x, y: spot.y - cluster.y }
  }

  const copyOffset = (nodeIds: readonly string[]) => {
    const lookup = flowState().nodeLookup
    return clearOffset(nodeIds.flatMap((id) => { const node = lookup.get(id); return node && node.type !== 'group' ? [nodeBox(node)] : [] }))
  }

  const pasteOffset = (nodes: readonly CanvasFlowNode[]) => clearOffset(nodes.filter((node) => !node.parentId).map((node) => {
    const size = newStoryNodeSize(node.type ?? '')
    return { ...node.position, width: node.measured?.width ?? node.width ?? size.width, height: node.measured?.height ?? node.height ?? size.height }
  }))

  /** New pictures inherit the 影游's frame so generation matches the player. */
  const mediaSeed = (scene: CanvasFlowNode | undefined, type: CanvasNodeMenuType): NodeData => {
    const format = deps().story?.story
    const name = typeof scene?.data.title === 'string' && scene.data.title.trim() ? scene.data.title.trim() : '剧情片段'
    const resolution = type === 'video' && format && /^\d+p$/.test(format.resolution) ? { resolution: format.resolution } : {}
    return {
      title: `${name} · 画面`,
      generation: { ...defaultCanvasNodeData(type).generation, ...(format ? { aspectRatio: format.aspectRatio } : {}), ...resolution },
    }
  }

  const finishWire = (fromId: string, fromHandle: string | null | undefined, client: StoryPoint) => {
    const d = deps()
    const state = flowState()
    const from = state.nodeLookup.get(fromId)
    const role = storyWireRole(from, fromHandle)
    if (!from || !role || (role === 'media' && !d.story)) return false
    const point = d.toFlowPoint(client)
    const nodes = [...state.nodeLookup.values()]
    const target = resolveStoryWireTarget({ from, fromHandle, point, nodes, edges: d.edgesRef.current, scale: paneScale(), zoom: state.transform[2] })
    if (target) { commit(resolveStoryConnection(target.connection, d.nodesRef.current)); return true }
    if (inside(point, nodeBox(from))) return true
    const hit = storyNodeAt(nodes, point, fromId)
    if (hit && role === 'media' && !isStoryNodeType(hit.type)) return false
    if (hit) { d.toast(storyWireRefusal(role, fromId, fromHandle, hit, d.nodesRef.current)); return true }
    d.setWireMenu({ x: client.x, y: client.y, flowPosition: point, sourceNodeId: fromId, sourceHandle: fromHandle ?? null, story: role })
    return true
  }

  /** Hanging a new interaction on a scene starts it where it clears the interactions already mounted there. */
  const mountSeed = (sceneId: string, interaction: StoryInteractionKind | undefined): NodeData => ({
    startSec: nextBeatStart(sceneId, interaction ?? 'tap', deps().nodesRef.current, deps().edgesRef.current),
  })

  const pickWireNode = (menu: CanvasWireMenuState, type: CanvasNodeMenuType, interaction?: StoryInteractionKind) => {
    const role = menu.story
    if (!role || !menu.flowPosition) return false
    if ((role === 'media' && !isStoryMediaTarget(type)) || (role === 'mount' && type !== 'story_interaction') || (role === 'mount-pick' && type !== 'story_scene')) return false
    const drop = storyDropBox(role, menu.flowPosition, newStoryNodeSize(type))
    const source = deps().nodesRef.current.find((node) => node.id === menu.sourceNodeId)
    const seed = role === 'media-pick' ? mediaSeed(source, type) : role === 'mount' ? mountSeed(menu.sourceNodeId, interaction) : undefined
    insert(type, freeSpot(drop.box, drop.upward), (node) => storyWireLink(role, menu.sourceNodeId, menu.sourceHandle, node), seed, interaction)
    return true
  }

  const createPictureNode = (targetId: string, type: 'video' | 'image') => {
    const lookup = flowState().nodeLookup
    const internal = lookup.get(targetId)
    if (!internal) return
    const target = { id: targetId, ...nodeBox(internal) }
    const size = newStoryNodeSize(type)
    const picture = { x: target.x + target.width / 2 - size.width / 2, y: target.y - MEDIA_GAP - size.height, ...size }
    const room = roomAbove(target, picture, [...lookup.values()].filter((node) => node.type !== 'group').map((node) => ({ id: node.id, ...nodeBox(node) })))
    const data = mediaSeed(deps().nodesRef.current.find((node) => node.id === targetId), type)
    const placed = insert(type, { x: picture.x, y: picture.y + room.shift },
      (node) => ({ source: node.id, sourceHandle: 'output', target: targetId, targetHandle: STORY_MEDIA_HANDLE }), data)
    if (!placed || !room.shift) return
    moveDown(room.moved, room.shift, '添加并连接节点')
    const left = Math.min(picture.x, target.x)
    reveal({ x: left, y: picture.y + room.shift, width: Math.max(picture.x + picture.width, target.x + target.width) - left, height: target.y + target.height - picture.y })
    deps().toast('已在上方腾出画面位置')
  }

  const quickAdd = (nodeId: string, handleId: string, anchor: StoryPoint) => {
    const d = deps()
    const node = flowState().nodeLookup.get(nodeId)
    const port = node && !d.writeLocked ? storyHandleCenter(node, handleId, paneScale()) : null
    if (!port) return
    const mount = handleId === STORY_INTERACT_HANDLE
    d.setWireMenu({
      x: anchor.x,
      y: anchor.y,
      flowPosition: mount ? { x: port.x, y: port.y + QUICK_MOUNT_REACH } : { x: port.x + QUICK_ADD_REACH, y: port.y },
      sourceNodeId: nodeId,
      sourceHandle: handleId,
      story: mount ? 'mount' : 'forward',
    })
  }

  const focusNode = (nodeId: string) => {
    const d = deps()
    const internal = flowState().nodeLookup.get(nodeId)
    if (!internal) return
    const next = d.nodesRef.current.map((node) => (Boolean(node.selected) === (node.id === nodeId) ? node : { ...node, selected: node.id === nodeId }))
    d.nodesRef.current = next
    d.setNodes(next)
    reveal(nodeBox(internal))
  }

  const organize = () => {
    const d = deps()
    if (d.writeLocked) return
    const lookup = flowState().nodeLookup
    const sized = d.nodesRef.current.flatMap((node) => {
      const internal = lookup.get(node.id)
      if (!internal) return []
      const box = nodeBox(internal)
      return [{ id: node.id, type: node.type, data: node.data, position: { x: box.x, y: box.y }, width: box.width, height: box.height }]
    })
    const positions = layoutStoryChapter(sized, d.edgesRef.current)
    if (!positions.size) { d.toast('还没有可整理的剧情节点'); return }
    const moved = new Set(positions.keys())
    d.record('整理剧情')
    d.animateNodeLayout(
      (current) => fitCanvasGroupsToMembers(
        current.map((node) => { const position = positions.get(node.id); return position ? { ...node, position } : node }),
        canvasGroupIdsContainingMembers(current, moved),
      ),
      () => window.requestAnimationFrame(() => void deps().flow?.fitView({ padding: 0.18, duration: 260 })),
    )
    d.markChanged('整理剧情')
    d.toast('已按剧情走向整理')
  }

  const placeNew = (type: CanvasNodeMenuType, center: StoryPoint) => {
    const size = newStoryNodeSize(type)
    const spot = freeSpot({ x: center.x - size.width / 2, y: center.y - size.height / 2, ...size })
    reveal({ ...spot, ...size })
    return spot
  }

  const removeEdge = (edgeId: string) => { if (!deps().writeLocked) deps().removeEdges([edgeId]) }

  const retargetInteraction = async (nodeId: string, nextKind: StoryInteractionKind) => {
    const d = deps()
    if (d.writeLocked) return
    const node = d.nodesRef.current.find((item) => item.id === nodeId)
    if (!node || node.type !== 'story_interaction') return
    const current = readInteractionData(node.data)
    if (current.spec.type === nextKind) return
    const next = readInteractionData(defaultInteractionData(nextKind, newId))
    const mapping = retargetHandleMap(current.spec, next.spec)
    const targets = new Map(d.nodesRef.current.map((item) => [item.id, typeof item.data.title === 'string' && item.data.title.trim() ? item.data.title.trim() : '未命名片段']))
    const dropped = d.edgesRef.current.filter((edge) => edge.source === nodeId && edge.data?.role === STORY_FLOW_ROLE && !mapping.get(edge.sourceHandle || STORY_OUTPUT_HANDLE))
    if (dropped.length) {
      const detail = dropped.map((edge) => `${interactionHandleLabel(current.spec, edge.sourceHandle || STORY_OUTPUT_HANDLE)}→${targets.get(edge.target) ?? '已删除节点'}`).join('、')
      const confirmed = await confirmAction({
        title: '切换互动类型',
        message: `换成「${STORY_INTERACTION_LABEL[nextKind]}」后，${dropped.length} 条分支线没有对应的出口，将断开：${detail}。`,
        confirmLabel: '断开并切换',
        danger: true,
      })
      if (!confirmed) return
    }
    const droppedIds = new Set(dropped.map((edge) => edge.id))
    const edges = d.edgesRef.current.flatMap((edge) => {
      if (edge.source !== nodeId || edge.data?.role !== STORY_FLOW_ROLE) return [edge]
      if (droppedIds.has(edge.id)) return []
      const sourceHandle = mapping.get(edge.sourceHandle || STORY_OUTPUT_HANDLE)
      return sourceHandle ? [{ ...edge, sourceHandle }] : []
    })
    const nodes = d.nodesRef.current.map((item) => item.id === nodeId
      ? { ...item, data: { ...item.data, ...retargetInteractionData(current, nextKind, newId) } }
      : item)
    d.record('切换互动类型')
    d.nodesRef.current = nodes
    d.edgesRef.current = edges
    d.setNodes(nodes)
    d.setEdges(edges)
    d.markChanged('切换互动类型')
  }

  const removeInteractionHandle = async (nodeId: string, handle: string) => {
    const d = deps()
    if (d.writeLocked) return false
    const node = d.nodesRef.current.find((item) => item.id === nodeId)
    if (!node || (node.type !== 'story_interaction' && node.type !== 'story_choice')) return false
    if (node.type === 'story_choice') {
      const choice = readChoiceData(node.data)
      const option = choice.options.find((item) => item.id === handle)
      if (!option) return false
      const dropped = d.edgesRef.current.filter((edge) => edge.source === nodeId && edge.data?.role === STORY_FLOW_ROLE && edge.sourceHandle === handle)
      const targets = new Map(d.nodesRef.current.map((item) => [item.id, typeof item.data.title === 'string' && item.data.title.trim() ? item.data.title.trim() : '未命名片段']))
      if (dropped.length) {
        const confirmed = await confirmAction({
          title: '删除选项',
          message: `删除「${option.label || '未命名'}」将断开 ${dropped.length} 条分支线：${dropped.map((edge) => targets.get(edge.target) ?? '已删除节点').join('、')}。`,
          confirmLabel: '断开并删除',
          danger: true,
        })
        if (!confirmed) return false
      }
      const next = removeChoiceOption(choice.options, handle, choice.defaultOptionId, 1)
      if (next.options === choice.options) return false
      const droppedIds = new Set(dropped.map((edge) => edge.id))
      d.record('删除选项')
      d.nodesRef.current = d.nodesRef.current.map((item) => item.id === nodeId ? {
        ...item,
        data: { ...item.data, options: next.options, ...(next.defaultOptionId !== choice.defaultOptionId ? { defaultOptionId: next.defaultOptionId } : {}) },
      } : item)
      d.edgesRef.current = d.edgesRef.current.filter((edge) => !droppedIds.has(edge.id))
      d.setNodes(d.nodesRef.current)
      d.setEdges(d.edgesRef.current)
      d.markChanged('删除选项')
      return true
    }
    const current = readInteractionData(node.data)
    if (current.spec.type !== 'choice' && current.spec.type !== 'hotspot') return false
    const entity = current.spec.type === 'choice' ? current.spec.options.find((option) => option.id === handle) : current.spec.zones.find((zone) => zone.id === handle)
    if (!entity) return false
    const dropped = d.edgesRef.current.filter((edge) => edge.source === nodeId && edge.data?.role === STORY_FLOW_ROLE && edge.sourceHandle === handle)
    const targets = new Map(d.nodesRef.current.map((item) => [item.id, typeof item.data.title === 'string' && item.data.title.trim() ? item.data.title.trim() : '未命名片段']))
    if (dropped.length) {
      const confirmed = await confirmAction({
        title: current.spec.type === 'choice' ? '删除选项' : '删除热区',
        message: `删除「${entity.label || '未命名'}」将断开 ${dropped.length} 条分支线：${dropped.map((edge) => targets.get(edge.target) ?? '已删除节点').join('、')}。`,
        confirmLabel: '断开并删除',
        danger: true,
      })
      if (!confirmed) return false
    }
    const droppedIds = new Set(dropped.map((edge) => edge.id))
    const data = current.spec.type === 'choice'
      ? { options: current.spec.options.filter((option) => option.id !== handle), ...(current.spec.defaultOptionId === handle ? { defaultOptionId: null } : {}) }
      : { zones: current.spec.zones.filter((zone) => zone.id !== handle) }
    const results = Object.fromEntries(Object.entries(current.results).filter(([key]) => key !== handle))
    d.record(current.spec.type === 'choice' ? '删除选项' : '删除热区')
    d.nodesRef.current = d.nodesRef.current.map((item) => item.id === nodeId ? { ...item, data: { ...item.data, ...data, results } } : item)
    d.edgesRef.current = d.edgesRef.current.filter((edge) => !droppedIds.has(edge.id))
    d.setNodes(d.nodesRef.current)
    d.setEdges(d.edgesRef.current)
    d.markChanged(current.spec.type === 'choice' ? '删除选项' : '删除热区')
    return true
  }

  return { quickAdd, createPictureNode, focusNode, removeEdge, organize, finishWire, pickWireNode, commit, placeNew, copyOffset, pasteOffset, retargetInteraction, removeInteractionHandle }
}

/** Story editing commands with a stable identity; they always read the latest canvas state. */
export function useStoryCanvasActions(deps: StoryActionDeps): StoryEditorActions {
  const ref = useRef(deps)
  useLayoutEffect(() => { ref.current = deps })
  return useMemo(() => createStoryActions(ref), [])
}
