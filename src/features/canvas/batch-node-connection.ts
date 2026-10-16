import { normalizeCanvasConnection, type CanvasConnectionInput, type CanvasFlowEdge, type CanvasFlowNode } from './editor-types'
import { appendCanvasVideoSourceToPlaylist, isCanvasVideoSource } from './playlist-node-drop'
import { resolveMaterialReferenceSchema } from './material-reference-drop'

export function canvasConnectionMediaType(node: CanvasFlowNode) {
  return node.data.mediaType || (node.type === 'note' ? 'text' : node.type === 'model_3d' ? 'model3d' : node.type) || 'image'
}

function createsCycle(edges: readonly CanvasFlowEdge[], source: string, target: string) {
  const nextBySource = new Map<string, string[]>()
  for (const edge of edges) {
    const next = nextBySource.get(edge.source) || []
    next.push(edge.target)
    nextBySource.set(edge.source, next)
  }
  const visited = new Set<string>()
  const pending = [target]
  while (pending.length) {
    const id = pending.pop()!
    if (id === source) return true
    if (visited.has(id)) continue
    visited.add(id)
    pending.push(...(nextBySource.get(id) || []))
  }
  return false
}

/** Single wires and batch drops share direction, duplicate and type rules. */
export function isCanvasConnectionAllowed(
  input: CanvasConnectionInput,
  nodes: readonly CanvasFlowNode[],
  edges: readonly CanvasFlowEdge[],
  maxEdges = 4000,
) {
  const connection = normalizeCanvasConnection(input)
  if (!connection || connection.source === connection.target || edges.length >= maxEdges) return false
  if (edges.some((edge) => (
    (edge.source === connection.source && edge.target === connection.target)
    || (edge.source === connection.target && edge.target === connection.source)
  ))) return false
  const source = nodes.find((node) => node.id === connection.source)
  const target = nodes.find((node) => node.id === connection.target)
  if (!source || !target || source.type === 'group' || target.type === 'group') return false
  if (createsCycle(edges, source.id, target.id)) return false
  if (target.type === 'playlist') return isCanvasVideoSource(source)
  if (source.type === 'playlist') return false
  const sourceType = canvasConnectionMediaType(source)
  const targetType = canvasConnectionMediaType(target)
  if (target.type === 'video_edit' && sourceType === 'video' && targetType === 'video') return true
  if (target.data.origin === 'upload' && targetType !== 'text') return false
  if (targetType === 'text' && sourceType !== 'text') return false
  if (targetType === 'image' && (sourceType === 'video' || sourceType === 'audio')) return false
  if (target.type === 'studio_3d' && sourceType !== 'image' && sourceType !== 'model3d') return false
  return true
}

export function planCanvasBatchConnections(input: {
  nodes: readonly CanvasFlowNode[]
  edges: readonly CanvasFlowEdge[]
  sourceNodeIds: readonly string[]
  targetNodeId: string
  maxEdges?: number
  createId?: () => string
}) {
  let nodes = [...input.nodes]
  const edges = [...input.edges]
  let added = 0
  let skipped = 0
  const createId = input.createId || (() => typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  const target = nodes.find((node) => node.id === input.targetNodeId)
  const type = target ? canvasConnectionMediaType(target) : null
  const isGenerator = target && target.type !== 'video_edit' && (type === 'image' || type === 'video' || type === 'audio')
  const schema = isGenerator ? resolveMaterialReferenceSchema({
    type, inputMode: target.data.generation?.inputMode, inputSchema: target.data.generation?.inputSchema,
  }) : null
  const referencedIds = new Set(target?.data.generation?.referenceNodeIds
    ?? edges.filter((edge) => edge.target === target?.id).map((edge) => edge.source))
  const counts = { image: 0, video: 0, audio: 0 }
  for (const id of referencedIds) {
    const reference = nodes.find((node) => node.id === id)
    const referenceType = reference ? canvasConnectionMediaType(reference) : null
    if (referenceType === 'image' || referenceType === 'video' || referenceType === 'audio') counts[referenceType]++
  }
  // A video editor has one source video; never silently replace it with the
  // last node in a multi-selection.
  let editSourceTaken = target?.type === 'video_edit'
    && Boolean(target.data.videoEdit?.sourceNodeId || target.data.videoUrl || target.data.contentUrl
      || edges.some((edge) => edge.target === target.id && nodes.some((node) => node.id === edge.source && isCanvasVideoSource(node))))
  for (const id of new Set(input.sourceNodeIds)) {
    const source = nodes.find((node) => node.id === id)
    const currentTarget = nodes.find((node) => node.id === input.targetNodeId)
    const connection = { source: id, target: input.targetNodeId, sourceHandle: 'output', targetHandle: 'input' }
    if (!source || !currentTarget || !isCanvasConnectionAllowed(connection, nodes, edges, input.maxEdges)) {
      skipped++
      continue
    }
    const mediaType = canvasConnectionMediaType(source)
    if (schema && mediaType !== 'text') {
      if (mediaType !== 'image' && mediaType !== 'video' && mediaType !== 'audio') { skipped++; continue }
      if (!referencedIds.has(id) && counts[mediaType] >= schema[mediaType].max) { skipped++; continue }
    }
    if (currentTarget.type === 'playlist') {
      const result = appendCanvasVideoSourceToPlaylist(currentTarget.data.playlistItems, source, createId)
      if (result.outcome !== 'added' && result.outcome !== 'duplicate') { skipped++; continue }
      if (result.outcome === 'added') nodes = nodes.map((node) => node.id === currentTarget.id
        ? { ...node, data: { ...node.data, playlistItems: result.items } } : node)
    }
    if (currentTarget.type === 'video_edit' && isCanvasVideoSource(source)) {
      if (editSourceTaken) { skipped++; continue }
      editSourceTaken = true
      nodes = nodes.map((node) => node.id === currentTarget.id ? {
        ...node,
        data: {
          ...node.data, videoUrl: source.data.videoUrl || source.data.contentUrl || null,
          contentUrl: source.data.contentUrl || source.data.videoUrl || null, materialId: source.data.materialId || null,
          videoEdit: { ...(node.data.videoEdit || {}), sourceKind: 'node', sourceNodeId: source.id },
        },
      } : node)
    }
    edges.push({ id: createId(), ...connection, type: 'bezier', data: { role: 'INPUT_DEFAULT' } })
    if (schema && (mediaType === 'image' || mediaType === 'video' || mediaType === 'audio')) {
      // Connected media must also become selected inputs when the generator
      // already stores picker references (including an intentionally empty list).
      // Otherwise a wire is visible but is silently omitted from generation.
      const previousReferences = currentTarget.data.generation?.referenceNodeIds
        ?? edges.filter((edge) => edge.target === currentTarget.id).flatMap((edge) => {
          const upstream = nodes.find((item) => item.id === edge.source)
          const upstreamType = upstream ? canvasConnectionMediaType(upstream) : null
          return upstreamType === 'image' || upstreamType === 'video' || upstreamType === 'audio' ? [edge.source] : []
        })
      nodes = nodes.map((node) => node.id === currentTarget.id ? {
        ...node,
        data: {
          ...node.data,
          generation: {
            ...(node.data.generation || {}),
            referenceNodeIds: Array.from(new Set([...previousReferences, source.id])),
          },
        },
      } : node)
    }
    if (schema && !referencedIds.has(id) && (mediaType === 'image' || mediaType === 'video' || mediaType === 'audio')) counts[mediaType]++
    referencedIds.add(id)
    added++
  }
  return { nodes, edges, added, skipped }
}
