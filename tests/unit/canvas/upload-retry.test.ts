import { describe, expect, it } from 'vitest'
import { CANVAS_UPLOAD_MAX_ATTEMPTS, canvasUploadRetryDelay } from '@/features/canvas/upload-retry'

describe('canvas upload retry', () => {
  it('backs off long enough for transient server upload queues', () => {
    expect(Array.from({ length: CANVAS_UPLOAD_MAX_ATTEMPTS - 1 }, (_, index) => canvasUploadRetryDelay(index + 1)))
      .toEqual([1000, 2000, 4000, 8000])
  })

  it('honours a server retry hint without waiting indefinitely', () => {
    expect(canvasUploadRetryDelay(1, 2)).toBe(2000)
    expect(canvasUploadRetryDelay(4, 120)).toBe(8000)
    expect(canvasUploadRetryDelay(2, Number.NaN)).toBe(2000)
  })
})
