import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getCanvasCurrentCostLabel } from '@/features/canvas/types'
import type { CanvasGenerationHistoryItem, CanvasNodeData } from '@/features/canvas/types'

const baseData: CanvasNodeData = {
  title: '生成节点',
  mediaType: 'image',
  origin: 'generate',
  imageUrl: 'https://example.com/current.png',
}

function history(cost: Partial<Pick<CanvasGenerationHistoryItem, 'url' | 'text' | 'actualCostPoints' | 'quotedCostPoints'>>): CanvasGenerationHistoryItem {
  return {
    id: 'history-1',
    url: 'https://example.com/current.png',
    status: 'ready',
    createdAt: '2026-10-08T00:00:00.000Z',
    ...cost,
  }
}

describe('canvas node cost badge', () => {
  it('prefers actual cost and falls back to the quote for the current node result', () => {
    expect(getCanvasCurrentCostLabel([
      history({ url: 'https://example.com/old.png', actualCostPoints: 30 }),
      history({ quotedCostPoints: 12, actualCostPoints: 15 }),
    ], baseData, 'image')).toEqual({ kind: 'actual', points: 15 })

    expect(getCanvasCurrentCostLabel([
      history({ quotedCostPoints: 12, actualCostPoints: null }),
    ], baseData, 'image')).toEqual({ kind: 'quoted', points: 12 })
  })

  it('matches text nodes by their current text and renders a bounded badge', () => {
    const data = { ...baseData, mediaType: 'text', text: '当前文本' } as CanvasNodeData
    expect(getCanvasCurrentCostLabel([
      history({ text: '旧文本', actualCostPoints: 99 }),
      history({ text: '当前文本', actualCostPoints: 8 }),
    ], data, 'text')).toEqual({ kind: 'actual', points: 8 })

    const node = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/nodes/CreativeNode.tsx'), 'utf8')
    const css = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/canvas.css'), 'utf8')
    expect(node).toContain('getCanvasCurrentCostLabel')
    expect(node).toContain('nori-canvas-node-cost')
    expect(css).toContain('.nori-canvas-node-cost')
    expect(css).toContain('max-width: 86px;')
    expect(css).toContain('text-overflow: ellipsis;')
  })
})
