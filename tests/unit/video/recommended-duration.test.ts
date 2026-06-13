import { describe, expect, it } from 'vitest'
import {
  recommendVideoDurationSeconds,
  withRecommendedVideoDurationOptions,
} from '@/lib/video/recommended-duration'

describe('video recommended duration', () => {
  const seedanceDurations = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  it('keeps short close-up beats short', () => {
    expect(recommendVideoDurationSeconds({
      shotType: '特写',
      cameraMove: '固定镜头',
      description: '月亮灯在小兔子手心发光',
      videoPrompt: '月亮灯在手心轻轻发光，固定镜头',
    }, seedanceDurations)).toBeLessThanOrEqual(3)
  })

  it('recommends longer duration for dialogue and multi-step action', () => {
    expect(recommendVideoDurationSeconds({
      srtSegment: '小兔子说别怕，我来帮你，然后伸出树叶，把掉进小水坑里的萤火虫救了出来。',
      description: '小兔子俯身伸出树叶，萤火虫抓住树叶离开水坑',
      videoPrompt: '小兔子俯身伸出树叶救起萤火虫，镜头轻轻跟随',
    }, seedanceDurations)).toBeGreaterThanOrEqual(7)
  })

  it('uses explicit LLM panel duration and snaps to supported model values', () => {
    expect(withRecommendedVideoDurationOptions({
      duration: 4.6,
      description: '小兔子在森林里散步',
    }, {
      duration: 2,
      resolution: '720p',
    }, [2, 4, 6, 8])).toEqual({
      duration: 4,
      resolution: '720p',
    })
  })

  it('disables generated audio when the panel prompt explicitly forbids background music', () => {
    expect(withRecommendedVideoDurationOptions({
      duration: 8,
      videoPrompt: '【Agent 视频分镜提示词】禁止生成背景音乐。Ava 英文口型同步说台词，医院走廊冷白灯。',
    }, {
      duration: 5,
      resolution: '720p',
      generateAudio: true,
    }, [4, 5, 6, 7, 8, 9, 10, 11, 12, 15])).toEqual({
      duration: 8,
      resolution: '720p',
      generateAudio: false,
    })
  })
})
