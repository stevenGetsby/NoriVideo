import { describe, expect, it } from 'vitest'
import {
  buildWholeContentClipBoundary,
  createClipContentMatcher,
  shouldFallbackToWholeContentSingleClip,
} from '@/lib/novel-promotion/story-to-script/clip-matching'

describe('clip content matcher', () => {
  it('matches a clip when the end anchor is contained inside the start anchor', () => {
    const content = '帮我生成一个可爱的动画短片，故事是一天晚上，小兔子在森林里散步。忽然，它发现一只萤火虫掉进了小水坑里。'
    const matcher = createClipContentMatcher(content)

    const match = matcher.matchBoundary(
      '一天晚上，小兔子在森林里散步。',
      '小兔子在森林里散步。',
      0,
    )

    expect(match).toMatchObject({
      level: 'L2',
      startIndex: content.indexOf('一天晚上'),
      endIndex: content.indexOf('。') + 1,
    })
  })

  it('falls back to whole content for a single clip polluted by boundary instructions', () => {
    const content = '请生成一个产品演示短片。Nori Cube 在工作台上亮起，最后形成完整视频缩略画面。'

    expect(shouldFallbackToWholeContentSingleClip({
      clipCount: 1,
      startText: '请生成一个产品演示短片',
      endText: 'return [] directly.',
      content,
    })).toBe(true)

    expect(buildWholeContentClipBoundary(content)).toEqual({
      startText: content,
      endText: content,
      content,
    })
  })

  it('does not fall back when the single clip start anchor is unrelated', () => {
    const content = '请生成一个产品演示短片。Nori Cube 在工作台上亮起。'

    expect(shouldFallbackToWholeContentSingleClip({
      clipCount: 1,
      startText: 'NOT_FOUND_START',
      endText: 'return [] directly.',
      content,
    })).toBe(false)
  })
})
