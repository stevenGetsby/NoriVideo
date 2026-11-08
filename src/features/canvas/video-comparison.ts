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
import type { CanvasGenerationConfig, CanvasGraphResponse, CanvasOperationsInput } from './types'

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
  prepare: () => Promise<{ expectedRevision: number; clientId: string }>
  saveOperations: (projectId: string, canvasId: string, operations: CanvasOperationsInput) => Promise<CanvasGraphResponse>
  acceptRevision: (expectedRevision: number, graph: CanvasGraphResponse) => Promise<boolean>
  loadServer: () => Promise<void>
}) {
  const current = await input.prepare()
  const graph = await input.saveOperations(input.projectId, input.canvasId, {
    expectedRevision: current.expectedRevision,
    clientId: current.clientId,
    changeSummary: '创建对照视频节点',
    ops: [
      { type: 'node.upsert', node: withoutCanvasId(flowNodeToCanvas(input.draft.node, input.canvasId)) },
      ...input.draft.edges.map((edge) => ({ type: 'edge.add' as const, edge: withoutCanvasId(flowEdgeToCanvas(edge, input.canvasId)) })),
    ],
  })
  if (!await input.acceptRevision(current.expectedRevision, graph)) {
    await input.loadServer()
    throw new CanvasRevisionConflictError('画布在创建对照节点时发生变化，请重试生成。')
  }
  const persistedNode = graph.nodes.find((node) => node.id === input.draft.node.id)
  if (!persistedNode || persistedNode.taskId) {
    await input.loadServer()
    throw new Error('对照节点已变化，请核对画布后重试生成。')
  }
  const persistedFlowNode = canvasNodeToFlow(persistedNode)
  const persistedEdges = graph.edges.filter((edge) => edge.targetNodeId === input.draft.node.id).map(canvasEdgeToFlow)
  return {
    nodes: input.nodes.map((node) => node.id === input.draft.node.id ? { ...persistedFlowNode, selected: true } : node),
    edges: [...input.edges.filter((edge) => edge.target !== input.draft.node.id), ...persistedEdges],
    graph,
    discard: async () => {
      const latest = await input.prepare()
      const removed = await input.saveOperations(input.projectId, input.canvasId, {
        expectedRevision: latest.expectedRevision,
        clientId: latest.clientId,
        changeSummary: '清理未提交的对照视频',
        ops: [
          ...input.draft.edges.map((edge) => ({ type: 'edge.delete' as const, id: edge.id })),
          { type: 'node.delete', id: input.draft.node.id },
        ],
      })
      if (!await input.acceptRevision(latest.expectedRevision, removed)) {
        await input.loadServer()
        throw new CanvasRevisionConflictError('画布版本已变化，无法安全清理未提交的对照节点。')
      }
      await input.loadServer()
    },
  }
}
