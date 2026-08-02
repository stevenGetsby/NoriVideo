import { describe, expect, it } from 'vitest'
import { validateCanvasOperationsSaveInput } from '@/lib/canvas/operations'

function node(id = 'node-1') {
  return {
    id,
    type: 'image',
    position: { x: 20, y: 30 },
    size: { width: 300, height: 200 },
    data: { title: '图片' },
    status: 'IDLE',
    taskId: null,
    runId: null,
    mediaObjectId: null,
    parentNodeId: null,
  }
}

function batch(ops: unknown[]) {
  return {
    expectedRevision: 4,
    clientId: 'browser-tab-1',
    changeSummary: '编辑画布',
    ops,
  }
}

describe('canvas operation validation', () => {
  it('strictly accepts the five scoped operation types', () => {
    const result = validateCanvasOperationsSaveInput(batch([
      { type: 'edge.delete', id: 'edge-old' },
      { type: 'node.delete', id: 'node-old' },
      { type: 'node.upsert', node: node() },
      {
        type: 'edge.add',
        edge: {
          id: 'edge-1',
          sourceNodeId: 'node-1',
          targetNodeId: 'node-2',
          sourceHandle: null,
          targetHandle: null,
          role: 'INPUT_DEFAULT',
        },
      },
      { type: 'canvas.update_meta', viewport: { x: 10, y: -20, zoom: 0.8 } },
    ]))

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.ops.map((operation) => operation.type)).toEqual([
      'edge.delete',
      'node.delete',
      'node.upsert',
      'edge.add',
      'canvas.update_meta',
    ])
  })

  it('rejects unknown fields, duplicate entity actions, and empty batches', () => {
    expect(validateCanvasOperationsSaveInput(batch([])).success).toBe(false)
    expect(validateCanvasOperationsSaveInput(batch([
      { type: 'node.upsert', node: { ...node(), canvasId: 'must-not-be-client-controlled' } },
    ])).success).toBe(false)
    expect(validateCanvasOperationsSaveInput(batch([
      { type: 'node.delete', id: 'node-1' },
      { type: 'node.upsert', node: node() },
    ])).success).toBe(false)
    expect(validateCanvasOperationsSaveInput(batch([
      { type: 'arbitrary.execute', command: 'rm -rf /' },
    ])).success).toBe(false)
  })
})
