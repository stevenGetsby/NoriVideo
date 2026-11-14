import { describe, expect, it } from 'vitest'
import { collectSelectionDownloadNodes } from '@/features/canvas/selection-download'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'

const node = (id: string, type: string, data: Record<string, unknown> = {}): CanvasFlowNode => ({
  id, type, position: { x: 0, y: 0 }, data: { title: id, ...data },
}) as unknown as CanvasFlowNode

describe('multi-selection shared download', () => {
  const nodes = [
    node('image-1', 'image', { imageUrl: 'https://cdn.test/a.png' }),
    node('video-1', 'video', { videoUrl: 'https://cdn.test/a.mp4' }),
    node('empty-1', 'image', {}),
    node('text-1', 'text', { text: '台词' }),
    node('text-blank', 'text', { text: '   ' }),
    node('studio-1', 'studio_3d', {}),
    node('group-1', 'group', { memberIds: ['image-1', 'video-1'] }),
  ]

  it('keeps canvas order and drops nodes without downloadable content', () => {
    const selected = nodes.filter((item) => ['video-1', 'image-1', 'empty-1', 'text-blank', 'text-1'].includes(item.id))
    expect(collectSelectionDownloadNodes(nodes, selected).map((item) => item.id)).toEqual(['image-1', 'video-1', 'text-1'])
  })

  it('expands a selected group to its members once and never packs the group itself', () => {
    const selected = nodes.filter((item) => ['group-1', 'image-1'].includes(item.id))
    expect(collectSelectionDownloadNodes(nodes, selected).map((item) => item.id)).toEqual(['image-1', 'video-1'])
  })

  it('treats a 3D studio node as downloadable and returns nothing for empty selections', () => {
    expect(collectSelectionDownloadNodes(nodes, [nodes[5]]).map((item) => item.id)).toEqual(['studio-1'])
    expect(collectSelectionDownloadNodes(nodes, [nodes[2], nodes[4]])).toEqual([])
  })
})
