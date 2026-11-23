import { describe, expect, it } from 'vitest'
import { buildCanvasNodeSummaryV1, pageCanvasHistoryV1, summarizeCanvasHistoryItemV1 } from '@/lib/canvas/graph-summary'
import { createCanvasNodeDetailVersion, type CanvasGenerationHistoryItem, type CanvasNode } from '@/features/canvas/types'

function history(count: number): CanvasGenerationHistoryItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `entry-${String(index).padStart(2, '0')}`,
    url: `https://media.test/${index}.png`,
    prompt: `private prompt ${index} ${'x'.repeat(500)}`,
    text: `text ${index}`,
    references: [{ id: `ref-${index}`, title: 'reference', type: 'image' as const, previewUrl: 'private-ref' }],
    parameters: { aspectRatio: '16:9', nested: null },
    actualCostPoints: index,
    createdAt: `2026-11-21T00:00:${String(index).padStart(2, '0')}.000Z`,
    status: 'ready' as const,
  }))
}

function node(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'node-1', canvasId: 'canvas-1', type: 'image', position: { x: 1, y: 2 }, size: { width: 320, height: 240 },
    status: 'SUCCEEDED', taskId: 'task-1', runId: null, mediaObjectId: null, parentNodeId: null,
    data: {
      title: '图', mediaType: 'image', contentUrl: 'https://media.test/0.png', materialId: 'material-1',
      history: history(30),
      generation: {
        modelKey: 'model', taskId: 'task-1', aspectRatio: '16:9', referenceNodeIds: ['node-2'],
        referenceSummary: [{ id: 'node-2', title: '角色', type: 'image', previewUrl: 'thumb.png' }],
        parameters: { quality: 'high', prompt: 'private prompt', nested: { no: true } },
      },
      unknownExtension: { large: 'must not be copied' },
      ...overrides.data,
    } as CanvasNode['data'],
    ...overrides,
  }
}

describe('canvas graph summary v1', () => {
  it('keeps topology, current media and cost while dropping history bodies and unknown fields', () => {
    const summary = buildCanvasNodeSummaryV1(node())
    expect(summary).toMatchObject({
      id: 'node-1', canvasId: 'canvas-1', position: { x: 1, y: 2 }, historyCount: 30,
      data: {
        contentUrl: 'https://media.test/0.png',
        generation: { modelKey: 'model', aspectRatio: '16:9', parameters: { quality: 'high' } },
      },
    })
    expect(summary.data.history).toBeUndefined()
expect(summary.data.currentCost).toEqual({ kind: 'actual', points: 0 })
    expect(summary.data.generation?.parameters).not.toHaveProperty('prompt')
    expect(summary.data.generation?.parameters).not.toHaveProperty('nested')
    expect(summary.data).not.toHaveProperty('unknownExtension')
    expect(summary.detailVersion).toBe(createCanvasNodeDetailVersion(node()))
    expect(JSON.stringify(summary)).not.toContain('private prompt')
  })

  it('changes detailVersion when an async worker writes a result without changing canvas revision', () => {
    const running = node({ status: 'RUNNING', data: { ...node().data, progress: 20 } })
    const completed = node({ status: 'SUCCEEDED', data: { ...node().data, contentUrl: 'finished.png', progress: 100 } })
    expect(createCanvasNodeDetailVersion(running)).not.toBe(createCanvasNodeDetailVersion(completed))
  })

  it('pages history newest first with a stable id cursor and lightweight entries', () => {
    const entries = history(45)
    const first = pageCanvasHistoryV1(entries, { limit: 20 })
    expect(first.items.map((item) => item.id)).toEqual(history(45).map((item) => item.id).reverse().slice(0, 20))
    expect(first.nextCursor).toBe('entry-25')
    const second = pageCanvasHistoryV1(entries, { limit: 20, cursor: first.nextCursor })
    expect(second.items).toHaveLength(20)
    expect(second.items[0].id).toBe('entry-24')
    const last = pageCanvasHistoryV1(entries, { limit: 20, cursor: second.nextCursor })
    expect(last.items).toHaveLength(5)
    expect(last.nextCursor).toBeNull()
    const summary = summarizeCanvasHistoryItemV1(first.items[0])
    expect(summary.references).toBeUndefined()
    expect(summary.referenceCount).toBe(1)
    expect(summary.prompt?.length).toBeLessThanOrEqual(160)
    expect(summary.parameters).toMatchObject({ aspectRatio: '16:9' })
  })

  it('does not resurrect an empty history as an unloaded node during card rendering', () => {
    const summary = buildCanvasNodeSummaryV1(node({ data: { title: 'empty', history: [] } }))
    expect(summary.historyCount).toBe(0)
    expect(summary.data?.history).toBeUndefined()
  })
})
