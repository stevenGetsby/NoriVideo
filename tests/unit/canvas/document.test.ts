import { describe, expect, it } from 'vitest'
import {
  MAX_CANVAS_DOCUMENT_BYTES,
  parseCanvasDocumentSaveInput,
  validateCanvasDocumentSaveInput,
} from '@/lib/canvas/document'

function node(id: string, type = 'image') {
  const data: Record<string, unknown> = { title: id, mediaType: type === 'text' ? 'text' : 'image' }
  return {
    id,
    type,
    position: { x: 120, y: 240 },
    size: { width: 300, height: 200 },
    data,
    status: 'IDLE',
    taskId: null,
    runId: null,
    mediaObjectId: null,
    parentNodeId: null,
  }
}

function documentInput() {
  return {
    expectedRevision: 3,
    clientId: 'browser-tab-a',
    changeSummary: '连接两个节点',
    viewport: { x: -20, y: 18, zoom: 0.85 },
    nodes: [node('source', 'text'), node('target')],
    edges: [{
      id: 'edge-1',
      sourceNodeId: 'source',
      targetNodeId: 'target',
      sourceHandle: 'output',
      targetHandle: 'input',
      role: 'INPUT_TEXT',
    }],
  }
}

describe('canvas document validation', () => {
  it('accepts a complete revisioned graph document', () => {
    expect(parseCanvasDocumentSaveInput(documentInput())).toEqual({
      schema_version: 1,
      ...documentInput(),
    })
  })

  it('accepts a revisioned zero-node graph document', () => {
    const empty = {
      ...documentInput(),
      nodes: [],
      edges: [],
      changeSummary: '清空画布',
    }

    expect(parseCanvasDocumentSaveInput(empty)).toEqual({
      schema_version: 1,
      ...empty,
    })
  })

  it('upgrades legacy versionless documents and rejects unknown future schemas', () => {
    expect(parseCanvasDocumentSaveInput(documentInput())?.schema_version).toBe(1)
    expect(parseCanvasDocumentSaveInput({ schema_version: 1, ...documentInput() })?.schema_version).toBe(1)
    expect(parseCanvasDocumentSaveInput({ schema_version: 2, ...documentInput() })).toBeNull()
  })

  it('rejects dangling and duplicate graph edges', () => {
    const dangling = documentInput()
    dangling.edges[0].targetNodeId = 'missing'
    expect(parseCanvasDocumentSaveInput(dangling)).toBeNull()

    const duplicate = documentInput()
    duplicate.edges.push({ ...duplicate.edges[0], id: 'edge-2' })
    expect(parseCanvasDocumentSaveInput(duplicate)).toBeNull()
  })

  it('rejects unsupported node types and oversized documents', () => {
    const unsupported = documentInput()
    unsupported.nodes[0].type = 'arbitrary-code-node'
    expect(parseCanvasDocumentSaveInput(unsupported)).toBeNull()

    const oversized = documentInput()
    oversized.nodes = Array.from({ length: 1_001 }, (_, index) => node(`node-${index}`))
    oversized.edges = []
    expect(parseCanvasDocumentSaveInput(oversized)).toBeNull()
  })

  it('rejects node payloads larger than the per-node safety limit', () => {
    const oversizedData = documentInput()
    oversizedData.nodes[0].data = { prompt: 'x'.repeat(513 * 1024) }
    expect(parseCanvasDocumentSaveInput(oversizedData)).toBeNull()
  })

  it('reports a clear error when the complete document exceeds its byte budget', () => {
    const oversizedDocument = {
      ...documentInput(),
      ignoredPadding: 'x'.repeat(MAX_CANVAS_DOCUMENT_BYTES),
    }
    const result = validateCanvasDocumentSaveInput(oversizedDocument)

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'CANVAS_DOCUMENT_TOO_LARGE',
        maxBytes: MAX_CANVAS_DOCUMENT_BYTES,
      },
    })
    if (result.success) throw new Error('expected the document to exceed its byte budget')
    expect(result.error.actualBytes).toBeGreaterThan(MAX_CANVAS_DOCUMENT_BYTES)
    expect(result.error.message).toContain('16 MiB')
    expect(parseCanvasDocumentSaveInput(oversizedDocument)).toBeNull()
  })

  it.each(['PANORAMA_VIEW', 'STUDIO_CAMERA'])('persists derived canvas edge role %s', (role) => {
    const derived = documentInput()
    derived.edges[0].role = role
    expect(parseCanvasDocumentSaveInput(derived)?.edges[0].role).toBe(role)
  })
})
