import { describe, expect, it } from 'vitest'
import {
  canvasMaterialReferenceConflictMessage,
  jsonContainsExactString,
  summarizeCanvasMaterialReferences,
} from '@/lib/canvas/material-reference-guard'

describe('canvas material deletion guard', () => {
  it('finds exact ids at arbitrary JSON depth without matching substrings', () => {
    expect(jsonContainsExactString({
      history: [{ references: ['material-1'] }],
    }, 'material-1')).toBe(true)
    expect(jsonContainsExactString({
      url: 'https://assets.test/material-1/image.jpg',
      label: 'prefix-material-1',
    }, 'material-1')).toBe(false)
  })

  it('deduplicates documents and covers current, template, snapshot, and 3D references', () => {
    const result = summarizeCanvasMaterialReferences('material-1', [
      {
        id: 'canvas-1',
        nodes: [
          {
            data: { materialId: 'material-1', history: [{ materialId: 'material-1' }] },
            studioDocument: { document: { objects: [{ materialId: 'material-1' }] } },
          },
        ],
        snapshots: [
          {
            id: 'snapshot-1',
            document: { nodes: [{ data: { materialId: 'other-material' } }] },
            studioDocuments: [{ document: { panoramaMaterialId: 'material-1' } }],
          },
          {
            id: 'snapshot-2',
            document: { nodes: [{ data: { referenceMaterialIds: ['material-1'] } }] },
            studioDocuments: [],
          },
        ],
      },
      {
        id: 'canvas-2',
        nodes: [{ data: { materialId: 'other-material' }, studioDocument: null }],
        snapshots: [],
      },
    ], [
      {
        id: 'template-1',
        nodes: [{ data: { materialId: 'other-material' } }],
        edges: [{ data: { maskMaterialId: 'material-1' } }],
        studioDocuments: [{ document: { captures: [{ materialId: 'material-1' }] } }],
      },
      {
        id: 'template-2',
        nodes: [],
        edges: [],
        studioDocuments: [],
      },
    ])

    expect(result).toEqual({
      referenced: true,
      counts: {
        currentCanvases: 1,
        workflowTemplates: 1,
        historySnapshots: 2,
      },
    })
    expect(canvasMaterialReferenceConflictMessage(result.counts)).toContain(
      '1 个当前画布、1 个工作流模板、2 个历史版本',
    )
  })

  it('allows deletion only when every durable representation is unreferenced', () => {
    expect(summarizeCanvasMaterialReferences('material-1', [{
      id: 'canvas-1',
      nodes: [{ data: { materialId: 'material-2' }, studioDocument: null }],
      snapshots: [{ id: 'snapshot-1', document: {}, studioDocuments: [] }],
    }], [{
      id: 'template-1',
      nodes: [],
      edges: [],
      studioDocuments: [],
    }])).toEqual({
      referenced: false,
      counts: {
        currentCanvases: 0,
        workflowTemplates: 0,
        historySnapshots: 0,
      },
    })
  })

  it('also protects URL-only legacy nodes before deleting the storage object', () => {
    const result = summarizeCanvasMaterialReferences([
      'material-1',
      '/api/media/object-1',
      'frameos-material-owner-1/upload.png',
    ], [{
      id: 'canvas-legacy',
      nodes: [{
        data: { contentUrl: '/api/media/object-1', materialId: null },
        studioDocument: null,
      }],
      snapshots: [],
    }], [])

    expect(result.referenced).toBe(true)
    expect(result.counts.currentCanvases).toBe(1)
  })
})
