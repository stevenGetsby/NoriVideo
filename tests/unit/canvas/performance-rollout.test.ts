import { expect, it } from 'vitest'
import { resolveCanvasPerformanceFlags } from '@/features/canvas/performance-rollout'

it('requires an explicit project rollout in production and leaves both switches independent', () => {
  const request = { mode: 'canvas' as const, workId: 'work-1', production: true }
  expect(resolveCanvasPerformanceFlags(request)).toEqual({ summary: false, projection: false })
  expect(resolveCanvasPerformanceFlags({ ...request, workIds: 'work-2', summary: '1', projection: '1' })).toEqual({ summary: false, projection: false })
  expect(resolveCanvasPerformanceFlags({ ...request, workIds: 'work-2, work-1', summary: '1', projection: '0' })).toEqual({ summary: true, projection: false })
  expect(resolveCanvasPerformanceFlags({ ...request, workIds: 'work-1', summary: '0', projection: '1' })).toEqual({ summary: false, projection: true })
})

it('never applies the new protocol or renderer to story projects', () => {
  expect(resolveCanvasPerformanceFlags({ mode: 'story', workId: 'work-1', production: false, summary: '1', projection: '1' }))
    .toEqual({ summary: false, projection: false })
})
