import { describe, expect, it } from 'vitest'
import { calcVideo, calcVideoByTokens } from '@/lib/billing/cost'
import { listAilinkSelectableModels } from '@/lib/providers/ailink/catalog'

// 火山官方价：2.5 为 70/42（480p/720p）、77/46（1080p）元/百万 token；
// flash 为 46/28 元/百万 token（480p/720p 同价）。5s 16:9 不含视频输入官方示例：
// 2.5 720p ≈ 7.56 元；flash 720p ≈ 4.97 元。
describe('ailink seedance pricing', () => {
  it('both models are selectable once priced', () => {
    expect(listAilinkSelectableModels().map((model) => model.modelId)).toEqual([
      'doubao-seedance-2-5',
      'doubao-seedance-2-5-flash',
    ])
  })

  it('2.5 720p 5s matches the official ≈7.56 example', () => {
    const cost = calcVideo('ailink::doubao-seedance-2-5', '720p', 1, { duration: 5, containsVideoInput: false })
    expect(cost).toBeGreaterThan(7.0)
    expect(cost).toBeLessThan(8.2)
  })

  it('flash 720p 5s matches the official ≈4.97 example', () => {
    const cost = calcVideo('ailink::doubao-seedance-2-5-flash', '720p', 1, { duration: 5, containsVideoInput: false })
    expect(cost).toBeGreaterThan(4.5)
    expect(cost).toBeLessThan(5.4)
  })

  it('flash video input settles at the 28 rate', () => {
    const cost = calcVideoByTokens('ailink::doubao-seedance-2-5-flash', 1_000_000, {
      containsVideoInput: true,
      resolution: '720p',
    })
    expect(cost).toBeCloseTo(28, 5)
  })

  it('flash rejects 1080p', () => {
    expect(() => calcVideo('ailink::doubao-seedance-2-5-flash', '1080p', 1, {
      duration: 5,
      containsVideoInput: false,
    })).toThrow()
  })
})
