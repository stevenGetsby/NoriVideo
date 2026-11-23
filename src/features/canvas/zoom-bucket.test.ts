import { describe, expect, it } from 'vitest'
import type { ReactFlowState } from '@xyflow/react'
import { CANVAS_LOW_DETAIL_ZOOM, selectZoomBucket } from './zoom-bucket'

const at = (zoom: number) => selectZoomBucket({ transform: [0, 0, zoom] } as ReactFlowState)

describe('selectZoomBucket', () => {
  it('maps zoom to coarse detail buckets', () => {
    expect(at(0.1)).toBe(0)
    expect(at(0.34)).toBe(0)
    expect(at(CANVAS_LOW_DETAIL_ZOOM)).toBe(1)
    expect(at(0.5)).toBe(1)
    expect(at(0.7)).toBe(2)
    expect(at(1)).toBe(2)
    expect(at(1.4)).toBe(3)
    expect(at(3)).toBe(4)
    expect(at(4.5)).toBe(5)
  })

  it('stays stable within a bucket so nodes do not re-render every zoom frame', () => {
    expect(at(0.8)).toBe(at(1.2))
    expect(at(1.5)).toBe(at(2.5))
  })
})
