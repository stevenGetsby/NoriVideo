import { describe, expect, it, vi } from 'vitest'
import { createFlowNode, flowEdgeToCanvas, flowNodeToCanvas } from '@/features/canvas/editor-types'
import { buildCanvasOperations } from '@/features/canvas/state/canvas-operations'
import { createVideoComparisonDraft, persistVideoComparisonDraft, shouldCreateVideoComparison } from '@/features/canvas/video-comparison'
import type { CanvasOperation } from '@/features/canvas/types'
import { validateCanvasOperationsSaveInput } from '@/lib/canvas/operations'

describe('video comparison generation', () => {
  it('migrates a cached legacy frame wire without accepting arbitrary roles', () => {
    const source = createFlowNode('video', { x: 0, y: 0 })
    const frame = createFlowNode('image', { x: 500, y: 0 })
    const edge = flowEdgeToCanvas({
      id: 'legacy-frame-edge', source: source.id, target: frame.id,
      sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'VIDEO_FRAME' },
    }, 'canvas-1')
    expect(edge.role).toBe('REF')
    const input = {
      schema_version: 1 as const, expectedRevision: 0, clientId: 'test-client', changeSummary: '恢复本地未同步版本',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [source, frame].map((node) => flowNodeToCanvas(node, 'canvas-1')), edges: [edge],
    }
    expect(validateCanvasOperationsSaveInput({
      expectedRevision: 0, clientId: 'test-client', changeSummary: '恢复本地未同步版本',
      ops: buildCanvasOperations({ ...input, nodes: [], edges: [] }, input),
    }).success).toBe(true)
    const invalid = flowEdgeToCanvas({
      id: 'invalid-edge', source: source.id, target: frame.id,
      sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'UNSUPPORTED_ROLE' },
    }, 'canvas-1')
    expect(invalid.role).toBe('UNSUPPORTED_ROLE')
  })

  it('persists captured video frames with a valid reference role', () => {
    const source = createFlowNode('video', { x: 0, y: 0 })
    const frame = createFlowNode('image', { x: 500, y: 0 })
    frame.data.generation = { parameters: { videoFrameCapture: true } }
    const edge = flowEdgeToCanvas({
      id: 'frame-edge', source: source.id, target: frame.id,
      sourceHandle: 'output', targetHandle: 'input', type: 'bezier', data: { role: 'REF' },
    }, 'canvas-1')
    const operations = buildCanvasOperations({
      schema_version: 1, expectedRevision: 0, clientId: 'test-client', changeSummary: null,
      viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [],
    }, {
      schema_version: 1, expectedRevision: 0, clientId: 'test-client', changeSummary: '已添加视频关键帧',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [source, frame].map((node) => flowNodeToCanvas(node, 'canvas-1')), edges: [edge],
    })
    expect(edge.role).toBe('REF')
    expect(validateCanvasOperationsSaveInput({
      expectedRevision: 0, clientId: 'test-client', changeSummary: '已添加视频关键帧', ops: operations,
    }).success).toBe(true)
  })

  it('persists the editor-only superresolution type as a server-allowed video node', () => {
    const source = createFlowNode('video_superresolve', { x: 800, y: 240 })
    expect(source.type).toBe('video')
    const editing = flowNodeToCanvas({ ...source, type: 'video_superresolve' }, 'canvas-1')
    expect(editing.type).toBe('video')

    const operations = buildCanvasOperations(
      {
        schema_version: 1,
        expectedRevision: 0,
        clientId: 'test-client',
        changeSummary: null,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
      },
      {
        schema_version: 1,
        expectedRevision: 0,
        clientId: 'test-client',
        changeSummary: '调整画布视图',
        viewport: { x: -10, y: 0, zoom: 1 },
        nodes: [editing],
        edges: [],
      },
    )
    expect(validateCanvasOperationsSaveInput({
      expectedRevision: 0,
      clientId: 'test-client',
      changeSummary: '调整画布视图',
      ops: operations,
    }).success).toBe(true)
  })

  it('only compares an existing successful video, never a first or running generation', () => {
    const empty = createFlowNode('video', { x: 800, y: 240 })
    expect(shouldCreateVideoComparison(empty)).toBe(false)

    const completed = createFlowNode('video', { x: 800, y: 240 })
    completed.data.videoUrl = 'https://example.com/previous.mp4'
    completed.data.__server = { ...completed.data.__server!, status: 'SUCCEEDED' }
    expect(shouldCreateVideoComparison(completed)).toBe(true)

    const running = { ...completed, data: { ...completed.data, __server: { ...completed.data.__server!, status: 'RUNNING' as const } } }
    expect(shouldCreateVideoComparison(running)).toBe(false)
    const localRunning = { ...completed, data: { ...completed.data, generationTask: { kind: 'text' as const, taskId: 'running-task' } } }
    expect(shouldCreateVideoComparison(localRunning)).toBe(false)
    const completedTask = { ...localRunning, data: { ...localRunning.data, generationTask: { kind: 'text' as const, taskId: 'finished-task', completed: true } } }
    expect(shouldCreateVideoComparison(completedTask)).toBe(true)
  })

  it('creates a blank output beside the original and inherits every input wire', () => {
    let nextId = 0
    const createId = () => `created-${++nextId}`
    const source = createFlowNode('video', { x: 800, y: 240 })
    source.data = {
      ...source.data,
      title: '镜头一',
      materialId: 'video-material',
      videoUrl: 'https://example.com/previous.mp4',
      contentUrl: 'https://example.com/previous.mp4',
      generation: { modelKey: 'nori::norivideo2.5', referenceNodeIds: ['image', 'video'], taskId: 'old-task', assetId: 'old-asset' },
      generationTask: { kind: 'text', taskId: 'old-task' },
    }
    const draft = createVideoComparisonDraft({
      source,
      edges: [
        { id: 'image-edge', source: 'image', target: source.id, data: { role: 'REF' } },
        { id: 'video-edge', source: 'video', target: source.id, data: { role: 'REF' } },
        { id: 'outgoing', source: source.id, target: 'next', data: { role: 'REF' } },
      ],
      prompt: '下一镜头',
      generation: { ...source.data.generation, modelKey: 'nori::norivideo2.5' },
      referenceNodeIds: ['image', 'video'],
      createId,
    })

    expect(draft.node.id).not.toBe(source.id)
    expect(draft.node.position).toEqual({ x: 800 + (source.width || 0) + 96, y: 240 })
    expect(draft.node.data.videoUrl).toBeNull()
    expect(draft.node.data.materialId).toBeNull()
    expect(draft.node.data.generationTask).toBeNull()
    expect(draft.node.data.generation).toMatchObject({ referenceNodeIds: ['image', 'video'], modelKey: 'nori::norivideo2.5' })
    expect(draft.node.data.generation?.taskId).toBeUndefined()
    expect(draft.node.data.origin).toBe('empty')
    expect(draft.node.data.progress).toBe(0)
    expect(draft.node.data.__server).toMatchObject({ status: 'IDLE', taskId: null, parentNodeId: null })
    expect(draft.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['image', draft.node.id],
      ['video', draft.node.id],
    ])
    expect(source.data.videoUrl).toBe('https://example.com/previous.mp4')
  })

  it('persists the blank node and inputs before generation and removes only that draft on failure', async () => {
    const source = createFlowNode('video', { x: 800, y: 240 })
    const reference = createFlowNode('image', { x: 0, y: 240 })
    const draft = createVideoComparisonDraft({
      source,
      edges: [{ id: 'input-edge', source: reference.id, target: source.id, data: { role: 'REF' } }],
      prompt: '下一镜头',
      generation: { modelKey: 'nori::norivideo2.5' },
      referenceNodeIds: [reference.id],
      createId: (() => { let index = 0; return () => `draft-${++index}` })(),
    })
    const canvasId = 'canvas-1'
    const nodes = [reference, source, draft.node]
    const edges = draft.edges
    let revision = 4
    const writes: CanvasOperation[][] = []
    const loadServer = vi.fn(async () => undefined)
    const graph = {
      canvas: { id: canvasId, projectId: 'project-1', title: '测试', revision, viewport: { x: 0, y: 0, zoom: 1 }, themeColor: null, visibility: 'workspace' as const, forkedFromId: null, createdAt: '', updatedAt: '' },
      nodes: [reference, source, draft.node].map((node) => flowNodeToCanvas(node, canvasId)),
      edges: draft.edges.map((edge) => flowEdgeToCanvas(edge, canvasId)),
    }
    const persisted = await persistVideoComparisonDraft({
      projectId: 'project-1', canvasId, sourceNodeId: source.id, draft, nodes, edges,
      prepare: async () => ({ expectedRevision: revision, clientId: 'test-client' }),
      saveOperations: async (_projectId, _canvasId, input) => {
        const validated = validateCanvasOperationsSaveInput(input)
        expect(validated.success).toBe(true)
        writes.push(input.ops)
        revision += 1
        return { ...graph, canvas: { ...graph.canvas, revision } }
      },
      acceptRevision: async () => true,
      loadServer,
    })
    expect(writes[0]?.map((operation) => operation.type)).toEqual(['node.upsert', 'edge.add'])
    expect(persisted.nodes.find((node) => node.id === draft.node.id)?.data.__server?.status).toBe('IDLE')
    expect(persisted.edges.filter((edge) => edge.target === draft.node.id)).toHaveLength(1)
    await persisted.discard()
    expect(writes[1]?.map((operation) => operation.type)).toEqual(['edge.delete', 'node.delete'])
    expect(writes[1]).not.toContainEqual({ type: 'node.delete', id: source.id })
    expect(loadServer).toHaveBeenCalledOnce()
  })
})
