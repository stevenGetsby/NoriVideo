import { describe, expect, it } from 'vitest'
import { calcVideo, calcVideoByTokens } from '@/lib/billing/cost'

const MODEL = 'kuaizi::doubao-seedance-2-5-260628'

// 官方口径：token 计价，70 元/百万 token（480p/720p，不含视频输入）、42（含视频输入）、
// 77/46（1080p）。5s 16:9 不含视频输入官方示例：480p 3.36 元、720p 7.56 元、1080p 18.71 元。
describe('seedance 2.5 token pricing', () => {
  it('480p 5s 16:9 without video input ≈ official 3.36', () => {
    const cost = calcVideo(MODEL, '480p', 1, { duration: 5, containsVideoInput: false })
    expect(cost).toBeGreaterThan(3.0)
    expect(cost).toBeLessThan(3.8)
  })

  it('720p 5s 16:9 without video input ≈ official 7.56', () => {
    const cost = calcVideo(MODEL, '720p', 1, { duration: 5, containsVideoInput: false })
    expect(cost).toBeGreaterThan(7.0)
    expect(cost).toBeLessThan(8.2)
  })

  it('1080p uses the 77 rate and lands near official 18.71', () => {
    const cost = calcVideo(MODEL, '1080p', 1, { duration: 5, containsVideoInput: false })
    expect(cost).toBeGreaterThan(17.0)
    expect(cost).toBeLessThan(20.5)
  })

  it('cost scales linearly with duration and 30s is allowed', () => {
    const five = calcVideo(MODEL, '720p', 1, { duration: 5, containsVideoInput: false })
    const ten = calcVideo(MODEL, '720p', 1, { duration: 10, containsVideoInput: false })
    const thirty = calcVideo(MODEL, '720p', 1, { duration: 30, containsVideoInput: false })
    expect(ten).toBeCloseTo(five * 2, 5)
    expect(thirty).toBeCloseTo(five * 6, 5)
  })

  it('video input switches to the 42 rate and applies the 16:9 min-token floor', () => {
    // 5s 16:9 含视频输入：官方最低消费 90396 token（480p）/ 194400（720p），单价 42
    const withVideo = calcVideo(MODEL, '480p', 1, {
      duration: 5,
      containsVideoInput: true,
      inputVideoSeconds: 2,
    })
    expect(withVideo).toBeCloseTo((90396 / 1_000_000) * 42, 3)

    // floor 是官方最低消费：含视频输入后 2s 输入 + 5s 输出的 token 量贴着 floor
    const without = calcVideo(MODEL, '480p', 1, { duration: 5, containsVideoInput: false })
    expect(without).toBeCloseTo((5 * 864 * 496 * 24 / 1_000_000 / 1024) * 70, 3)
  })

  it('1080p with video input uses the 46 rate', () => {
    const cost = calcVideo(MODEL, '1080p', 1, {
      duration: 5,
      containsVideoInput: true,
      inputVideoSeconds: 2,
    })
    const tokens = Math.ceil((2 + 5) * 1920 * 1088 * 24 / 1024)
    expect(cost).toBeCloseTo((tokens / 1_000_000) * 46, 3)
  })

  it('calcVideoByTokens settles actual tokens with the resolution-aware rate', () => {
    const cost = calcVideoByTokens(MODEL, 1_000_000, { containsVideoInput: false, resolution: '1080p' })
    expect(cost).toBeCloseTo(77, 5)
  })
})
