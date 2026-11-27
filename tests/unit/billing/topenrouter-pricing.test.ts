import { describe, expect, it } from 'vitest'
import { calcVideo, calcVideoByTokens } from '@/lib/billing/cost'
import { listTopenrouterSelectableModels } from '@/lib/providers/topenrouter/catalog'

// 所有 Seedance 2.5 统一按官方价：70/42（480p/720p）、77/46（1080p）元/百万 token。
describe('topenrouter seedance pricing', () => {
  it('both models are selectable once priced', () => {
    expect(listTopenrouterSelectableModels().map((model) => model.modelId).sort()).toEqual([
      'doubao-seedance-2-5-260628',
      'doubao-seedance-2-5-260628-exp',
    ])
  })

  it('720p 5s matches the official ≈7.56 example', () => {
    const cost = calcVideo('topenrouter::doubao-seedance-2-5-260628', '720p', 1, { duration: 5, containsVideoInput: false })
    expect(cost).toBeGreaterThan(7.0)
    expect(cost).toBeLessThan(8.2)
  })

  it.each([
    ['topenrouter::doubao-seedance-2-5-260628', false, '720p', 70],
    ['topenrouter::doubao-seedance-2-5-260628-exp', true, '720p', 42],
    ['topenrouter::doubao-seedance-2-5-260628', false, '1080p', 77],
    ['huimengi::seedance-2.5', false, '720p', 70],
    ['huimengi::seedance-2.5', true, '1080p', 46],
    ['kuaizi::doubao-seedance-2-5-260628', false, '480p', 70],
  ])('%s containsVideoInput=%s %s settles at official rate', (model, containsVideoInput, resolution, rate) => {
    expect(calcVideoByTokens(model, 1_000_000, { containsVideoInput, resolution })).toBeCloseTo(rate, 5)
  })
})
