import type { NodeChange } from '@xyflow/react'
import type { CanvasFlowNode } from './editor-types'

/**
 * Returns true when every incoming React Flow node change is an active drag
 * position tick (`type === 'position'` and `dragging === true`).
 *
 * Pure drag-move frames only alter node coordinates on screen; they never add,
 * remove, select, resize, or mutate node `data`, so non-geometry derivations
 * (selection lists, incoming wires, global style/prefix lookup, task polling
 * signatures, generator props, asset sidebar, etc.) can safely skip work until
 * the drag settles (`dragging: false`) or a real content/selection change lands.
 */
export function isPurePositionDragChanges(changes: readonly NodeChange<CanvasFlowNode>[]): boolean {
  if (changes.length === 0) return false
  for (let i = 0; i < changes.length; i += 1) {
    const change = changes[i]
    if (change.type !== 'position' || change.dragging !== true) return false
  }
  return true
}

export type CanvasMemoNodeProps = {
  id: string
  type?: string
  data: unknown
  selected?: boolean
  isConnectable?: boolean
}

/**
 * Custom `React.memo` comparator for canvas node components that never read
 * `positionAbsoluteX`, `positionAbsoluteY`, `dragging`, `zIndex`, `width`, or
 * `height` props. React Flow already moves the outer `.react-flow__node` DOM
 * wrapper via CSS `transform`, so skipping inner re-renders during drag keeps
 * single-node and 50-node multi-select drags at zero React node work per frame.
 */
export function areCanvasNodePropsEqual(prev: CanvasMemoNodeProps, next: CanvasMemoNodeProps): boolean {
  return prev.id === next.id
    && prev.type === next.type
    && prev.data === next.data
    && prev.selected === next.selected
    && prev.isConnectable === next.isConnectable
}

export type CanvasMentionNodeDescriptor = {
  id: string
  type: 'image' | 'audio'
  title: string
  imageUrl: string | null
  contentUrl: string | null
  audioUrl: string | null
  materialId: string | null
}

/**
 * Builds a memoized mention-node extractor that short-circuits in O(1) on
 * identical `nodes` references (e.g. every pan/zoom store tick) and avoids
 * allocating any descriptor objects when a node array only replaced node
 * wrappers with unchanged `id`, `type`, and `data` references (e.g. every
 * drag tick).
 */
export function createCachedMentionNodesSelector() {
  let lastNodes: readonly CanvasFlowNode[] | null = null
  let lastMatchedSources: CanvasFlowNode[] = []
  let lastResult: CanvasMentionNodeDescriptor[] = []

  return function select(nodes: readonly CanvasFlowNode[]): CanvasMentionNodeDescriptor[] {
    if (nodes === lastNodes) return lastResult
    lastNodes = nodes

    // Fast path: check whether the sequence of image/audio nodes still has
    // identical (id, type, data) references — true on 100% of drag ticks!
    let matchedIndex = 0
    let same = true
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      if (node.type !== 'image' && node.type !== 'audio') continue
      const prev = lastMatchedSources[matchedIndex]
      if (!prev || prev.id !== node.id || prev.type !== node.type || prev.data !== node.data) {
        same = false
        break
      }
      matchedIndex += 1
    }
    if (same && matchedIndex === lastMatchedSources.length) {
      return lastResult
    }

    const nextSources: CanvasFlowNode[] = []
    const nextResult: CanvasMentionNodeDescriptor[] = []
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      if (node.type !== 'image' && node.type !== 'audio') continue
      nextSources.push(node)
      nextResult.push({
        id: node.id,
        type: node.type,
        title: node.data.title || '',
        imageUrl: node.data.imageUrl || null,
        contentUrl: node.data.contentUrl || null,
        audioUrl: node.data.audioUrl || null,
        materialId: node.data.materialId || null,
      })
    }
    lastMatchedSources = nextSources
    lastResult = nextResult
    return nextResult
  }
}
