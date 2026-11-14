import { resolveSceneMedia } from '@/lib/interactive/compile'
import { defaultBeatDuration, firstFreeBeatStart, readInteractionData } from '@/lib/interactive/interaction'
import { STORY_MOUNT_ROLE, type StoryInteractionKind } from '@/lib/interactive/types'
import type { CanvasFlowEdge, CanvasFlowNode } from '../editor-types'

type NodeLike = Pick<CanvasFlowNode, 'id' | 'type' | 'data'>
type EdgeLike = Pick<CanvasFlowEdge, 'id' | 'source' | 'target' | 'sourceHandle' | 'data'>

export type SceneBeat = { nodeId: string; title: string; kind: StoryInteractionKind; startSec: number; durationSec: number }

/** The interactions mounted on a scene, in timeline order. */
export function mountedBeats(sceneId: string, nodes: readonly NodeLike[], edges: readonly EdgeLike[]): SceneBeat[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return edges
    .filter((edge) => edge.source === sceneId && edge.data?.role === STORY_MOUNT_ROLE)
    .flatMap((edge) => {
      const node = byId.get(edge.target)
      if (node?.type !== 'story_interaction') return []
      const data = readInteractionData(node.data)
      return [{ nodeId: node.id, title: data.title, kind: data.spec.type, startSec: data.startSec, durationSec: data.durationSec }]
    })
    .sort((a, b) => a.startSec - b.startSec || a.nodeId.localeCompare(b.nodeId))
}

/** The scene's video length in seconds; null while unknown (no video yet, an image, or no recorded duration). */
export function sceneVideoDurationSec(sceneId: string, nodes: readonly NodeLike[], edges: readonly EdgeLike[]): number | null {
  const scene = nodes.find((node) => node.id === sceneId)
  if (!scene) return null
  const media = resolveSceneMedia(
    sceneId,
    scene.data,
    nodes.map((node) => ({ id: node.id, type: node.type ?? '', data: node.data })),
    edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, role: edge.data?.role })),
  )
  return media?.kind === 'video' && media.durationSec ? media.durationSec : null
}

/** Where a new interaction of this kind should start so it clears everything already mounted on the scene. */
export function nextBeatStart(sceneId: string, kind: StoryInteractionKind, nodes: readonly NodeLike[], edges: readonly EdgeLike[]): number {
  return firstFreeBeatStart(mountedBeats(sceneId, nodes, edges), defaultBeatDuration(kind), sceneVideoDurationSec(sceneId, nodes, edges))
}
