import { describe, expect, it } from 'vitest'
import {
  PROJECT_LEVEL,
  buildProjectDescription,
  normalizeProjectCreationConfig,
} from '@/lib/projects/creation-config'
import { ApiError } from '@/lib/api-errors'

describe('project creation config', () => {
  it('normalizes the supported project globals', () => {
    const config = normalizeProjectCreationConfig({
      projectLevel: PROJECT_LEVEL,
      projectStyle: 'anime',
      targetAudience: 'global-platform',
      videoRatio: '16:9',
      videoResolution: '480p',
      targetEpisodeDurationSeconds: '120',
    })

    expect(config).toMatchObject({
      projectLevel: 'Nori1.0',
      projectStyle: 'anime',
      targetAudience: 'global-platform',
      videoRatio: '16:9',
      videoResolution: '480p',
      targetEpisodeDurationSeconds: 120,
      usesCustomArtStylePrompt: false,
    })
    expect(config.artStylePrompt).toContain('现代动漫短剧画风')
    expect(config.targetAudiencePrompt).toContain('出海平台视频消费者')
  })

  it('uses custom art style prompt instead of the style default', () => {
    const config = normalizeProjectCreationConfig({
      projectStyle: 'live-action',
      artStylePrompt: '统一为低饱和写实都市夜景风格。',
    })

    expect(config.artStylePrompt).toBe('统一为低饱和写实都市夜景风格。')
    expect(config.usesCustomArtStylePrompt).toBe(true)
  })

  it('rejects unsupported project level and enumerations instead of silently downgrading', () => {
    expect(() => normalizeProjectCreationConfig({ projectLevel: '精品版2.0' }))
      .toThrow(ApiError)
    expect(() => normalizeProjectCreationConfig({ projectStyle: 'premium' }))
      .toThrow(ApiError)
    expect(() => normalizeProjectCreationConfig({ targetEpisodeDurationSeconds: 180 }))
      .toThrow(ApiError)
  })

  it('builds the compact project description used by project cards', () => {
    const config = normalizeProjectCreationConfig({
      projectStyle: 'live-action',
      targetAudience: 'zh-platform',
      videoRatio: '9:16',
      videoResolution: '720p',
      targetEpisodeDurationSeconds: 60,
    })

    expect(buildProjectDescription(config, '测试项目')).toBe('Nori1.0 · 真人 · 中文平台 · 9:16 · 720p · 60s · 测试项目')
  })
})
