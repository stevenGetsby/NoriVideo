import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  canvasMaterialReferenceConflictMessage,
  findCanvasMaterialReferences,
  findCanvasMaterialsReferences,
  jsonContainsExactString,
  summarizeCanvasMaterialReferences,
} from '@/lib/canvas/material-reference-guard'

describe('canvas material deletion guard', () => {
  it('does not read historical snapshot documents for single or bulk trash checks', async () => {
    const findCanvases = vi.fn(async () => [{
      id: 'canvas-1',
      nodes: [{ data: null, studioDocument: { document: { materialId: 'material-1' } } }],
      snapshots: [],
    }])
    const findTemplates = vi.fn(async () => [{
      id: 'template-1', nodes: [], edges: [{ asset: '/legacy/image.png' }], studioDocuments: [],
    }])
    const tx = { canvas: { findMany: findCanvases }, canvasWorkflowTemplate: { findMany: findTemplates } } as unknown as Prisma.TransactionClient
    const first = { id: 'material-1', resultUrl: null, storageKey: null }
    const second = { id: 'material-2', resultUrl: '/legacy/image.png', storageKey: null }

    const single = await findCanvasMaterialReferences(tx, 'owner', first, { includeHistory: false })
    expect(single.counts.currentCanvases).toBe(1)
    const batch = await findCanvasMaterialsReferences(tx, 'owner', [first, second])
    expect(batch.get('material-1')?.counts.currentCanvases).toBe(1)
    expect(batch.get('material-2')?.counts.workflowTemplates).toBe(1)
    expect(findCanvases).toHaveBeenCalledTimes(2)
    for (const [query] of findCanvases.mock.calls as unknown as [Prisma.CanvasFindManyArgs][]) {
      expect(query.where).toEqual({ userId: 'owner' })
      expect(query.select).not.toHaveProperty('snapshots')
    }
  })
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
      '1 个当前画布、1 个工作流模板',
    )
    expect(canvasMaterialReferenceConflictMessage(result.counts)).toContain(
      '历史版本仍可查看，不阻止移入回收站',
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
