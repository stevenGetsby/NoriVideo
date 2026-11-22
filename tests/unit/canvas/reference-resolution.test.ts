import { describe, expect, it } from 'vitest'
import { removeDeletedCanvasReferences, requireExistingReferenceNodeIds } from '@/features/canvas/reference-resolution'
import type { CanvasNodeData } from '@/features/canvas/types'
import { createMaterialFlowNode } from '@/features/canvas/material-node'
import { createVideoComparisonDraft } from '@/features/canvas/video-comparison'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'

describe('canvas material references', () => {
  it('preserves first/last frame order while deduplicating', () => {
    expect(requireExistingReferenceNodeIds(['b', 'a', 'b'], [{ id: 'a' }, { id: 'b' }])).toEqual(['b', 'a'])
  })
  it('does not silently drop missing inputs or send obsolete node ids', () => {
    expect(() => requireExistingReferenceNodeIds(['deleted'], [{ id: 'a' }])).toThrow('清除失效引用')
  })
  it('detaches explicitly deleted references even when no wire exists, without losing prompt or history', () => {
    const nodes: Array<{ id: string; data: CanvasNodeData }> = [
      { id: 'video', data: {
        prompt: '保留输入', history: [],
        generation: {
          modelKey: 'nori::norivideo2.5', referenceNodeIds: ['a', 'deleted', 'b'],
          referenceSummary: [{ id: 'a', title: '首帧', type: 'image' }, { id: 'deleted', title: '旧素材', type: 'image' }],
        },
      } },
      { id: 'untouched', data: { prompt: '不变' } },
    ]
    const result = removeDeletedCanvasReferences(nodes, new Set(['deleted']))
    expect(result[0].data).toMatchObject({
      prompt: '保留输入', history: [],
      generation: { modelKey: 'nori::norivideo2.5', referenceNodeIds: ['a', 'b'], referenceSummary: [{ id: 'a', title: '首帧', type: 'image' }] },
    })
    expect(result[1]).toBe(nodes[1])
    expect(nodes[0].data.generation?.referenceNodeIds).toEqual(['a', 'deleted', 'b'])
    // The previous snapshot can still restore all references on undo.
    expect(nodes[0].data.generation?.referenceSummary).toHaveLength(2)
  })
  it('supports grouped deletion and does not detach unrelated missing references without consent', () => {
    const nodes = [{ data: { generation: { referenceNodeIds: ['a', 'legacy-missing', 'b', 'c'] } } }]
    expect(removeDeletedCanvasReferences(nodes, new Set(['a', 'c']))[0].data.generation.referenceNodeIds)
      .toEqual(['legacy-missing', 'b'])
    expect(removeDeletedCanvasReferences(nodes, new Set(['unrelated']))[0]).toBe(nodes[0])
  })
  it('creates fully populated material nodes in one update', () => {
    for (const type of ['image', 'video', 'audio', 'model3d'] as const) {
      const node = createMaterialFlowNode({ id: 'material', url: '/test', type, source: 'upload', title: '人物' } as FrameosMaterialItem, { x: 300, y: 300 })
      expect(node?.data).toMatchObject({ materialId: 'material', contentUrl: '/test', mediaType: type, __server: { status: 'SUCCEEDED' } })
      expect(node?.type).toBe(type === 'model3d' ? 'model_3d' : type)
    }
  })
  it('never inserts empty/malformed material nodes', () => {
    expect(createMaterialFlowNode({ id: 'bad', type: 'image', url: null } as FrameosMaterialItem, { x: 0, y: 0 })).toBeNull()
  })
  it('restores the structured comparison index when a numbered take is re-imported', () => {
    const material = { id: 'take-3', url: '/take-3.mp4', type: 'video', source: 'toolbox', title: '镜头一 · 对照 3' } as FrameosMaterialItem
    const node = createMaterialFlowNode(material, { x: 0, y: 0 })
    expect(node?.data.title).toBe('镜头一')
    expect(node?.data.comparisonIndex).toBe(3)
    expect(createVideoComparisonDraft({
      source: node!,
      edges: [],
      prompt: '再来一条',
      generation: { modelKey: 'nori::norivideo2.5' },
      referenceNodeIds: [],
    }).node.data).toMatchObject({ title: '镜头一', comparisonIndex: 4 })
  })
  it('prefers structured metadata over a stale numbered suffix on re-import', () => {
    const material = { id: 'take-meta', url: '/take.mp4', type: 'video', source: 'toolbox', title: '镜头一 · 对照 3', metadata: { comparisonIndex: 5 } } as unknown as FrameosMaterialItem
    const node = createMaterialFlowNode(material, { x: 0, y: 0 })
    expect(node?.data.comparisonIndex).toBe(5)
  })
  it('leaves plain material titles untouched', () => {
    const node = createMaterialFlowNode({ id: 'plain', url: '/plain.mp4', type: 'video', source: 'upload', title: '镜头一' } as FrameosMaterialItem, { x: 0, y: 0 })
    expect(node?.data.title).toBe('镜头一')
    expect(node?.data.comparisonIndex).toBeUndefined()
  })
})
