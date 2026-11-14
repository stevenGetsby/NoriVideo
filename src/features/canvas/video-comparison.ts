import { cloneCanvasNodeDataForNewNode } from './clone-node-data'
import { CanvasRevisionConflictError } from './api/client'
import { withoutCanvasId } from './state/canvas-operations'
import {
  canvasEdgeToFlow,
  canvasNodeToFlow,
  flowEdgeToCanvas,
  flowNodeToCanvas,
} from './editor-types'
import type { CanvasFlowEdge, CanvasFlowNode } from './editor-types'
import type { CanvasGenerationConfig, CanvasGraphResponse, CanvasOperation } from './types'

export function shouldCreateVideoComparison(node: CanvasFlowNode): boolean {
  if ((node.data.mediaType || node.type) !== 'video' || (node.data.generationTask && !node.data.generationTask.completed)) return false
  const status = node.data.__server?.status
  if (status && status !== 'SUCCEEDED') return false
  return Boolean(node.data.videoUrl || node.data.contentUrl)
}

export function createVideoComparisonDraft(input: {
  source: CanvasFlowNode
  edges: readonly CanvasFlowEdge[]
  prompt: string
  generation: CanvasGenerationConfig
  referenceNodeIds: string[]
  createId?: () => string
}) {
  const createId = input.createId || (() => crypto.randomUUID())
  const sourceSize = {
    width: input.source.width || input.source.measured?.width || 300,
    height: input.source.height || input.source.measured?.height || 200,
  }
  const data = cloneCanvasNodeDataForNewNode(input.source.data, (id) => id)
  const node: CanvasFlowNode = {
    ...input.source,
    id: createId(),
    position: { x: input.source.position.x + sourceSize.width + 96, y: input.source.position.y },
    selected: true,
    dragging: false,
    data: {
      ...data,
      title: `${input.source.data.title || '视频节点'} · 对照`,
      origin: 'empty',
      materialId: null,
      contentUrl: null,
      videoUrl: null,
      audioUrl: null,
      imageUrl: null,
      posterUrl: null,
      modelUrl: null,
      cgtid: null,
      isFavorited: false,
      prompt: input.prompt,
      generation: { ...input.generation, referenceNodeIds: input.referenceNodeIds, assetId: undefined, taskId: undefined },
      generationTask: null,
      progress: 0,
      errorMessage: null,
      pollErrorMessage: null,
      __server: { status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null },
    },
  }
  const inheritedEdges = input.edges.filter((edge) => edge.target === input.source.id).map((edge) => ({
    ...structuredClone(edge),
    id: createId(),
    target: node.id,
    selected: false,
  }))
  return { node, edges: inheritedEdges }
}

export async function persistVideoComparisonDraft(input: {
  projectId: string
  canvasId: string
  sourceNodeId: string
  draft: ReturnType<typeof createVideoComparisonDraft>
  nodes: CanvasFlowNode[]
  edges: CanvasFlowEdge[]
  saveRevisioned: (input: { changeSummary: string; ops: CanvasOperation[] }) => Promise<CanvasGraphResponse>
  loadServer: () => Promise<CanvasGraphResponse>
}) {
  const draftNodeId = input.draft.node.id
  // The draft node is committed by the revisioned save before generation binds
  // a task to it. If anything after that commit fails, the blank node must not
  // survive on the canvas; always delete it against the authoritative graph.
  const removeDraft = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const graph = await input.loadServer()
      const persisted = graph.nodes.find((node) => node.id === draftNodeId)
      if (!persisted || persisted.taskId) return
      const edgeIds = graph.edges
        .filter((edge) => edge.targetNodeId === draftNodeId)
        .map((edge) => edge.id)
      try {
        await input.saveRevisioned({
          changeSummary: '清理未提交的对照视频',
          ops: [
            ...edgeIds.map((id) => ({ type: 'edge.delete' as const, id })),
            { type: 'node.delete' as const, id: draftNodeId },
          ],
        })
        await input.loadServer()
        return
      } catch (error) {
        if (!(error instanceof CanvasRevisionConflictError) || attempt > 0) throw error
      }
    }
  }
  let graph: CanvasGraphResponse
  try {
    graph = await input.saveRevisioned({
      changeSummary: '创建对照视频节点',
      ops: [
        { type: 'node.upsert', node: withoutCanvasId(flowNodeToCanvas(input.draft.node, input.canvasId)) },
        ...input.draft.edges.map((edge) => ({ type: 'edge.add' as const, edge: withoutCanvasId(flowEdgeToCanvas(edge, input.canvasId)) })),
      ],
    })
  } catch (error) {
    // An ambiguous failure can still have committed the operations server-side.
    await removeDraft().catch(() => undefined)
    throw error
  }
  const persistedNode = graph.nodes.find((node) => node.id === draftNodeId)
  if (!persistedNode || persistedNode.taskId) {
    await removeDraft().catch(() => undefined)
    throw new Error('对照节点已变化，请核对画布后重试生成。')
  }
  const persistedFlowNode = canvasNodeToFlow(persistedNode)
  const persistedEdges = graph.edges.filter((edge) => edge.targetNodeId === draftNodeId).map(canvasEdgeToFlow)
  return {
    nodes: input.nodes.map((node) => node.id === draftNodeId ? { ...persistedFlowNode, selected: true } : node),
    edges: [...input.edges.filter((edge) => edge.target !== draftNodeId), ...persistedEdges],
    graph,
    discard: removeDraft,
  }
}
