import { describe, expect, it } from 'vitest'
import {
  PROJECT_LEVEL,
  appendProjectArtStyleConstraint,
  buildAssetAestheticPrompt,
  buildProjectDescription,
  normalizeInitialEpisodeRange,
  normalizeProjectCreationConfig,
} from '@/lib/projects/creation-config'
import { ApiError } from '@/lib/api-errors'

describe('project creation config', () => {
  it('normalizes the supported project globals', () => {
    const config = normalizeProjectCreationConfig({
      projectLevel: PROJECT_LEVEL,
      projectStyle: 'anime-2.5d',
      targetAudience: 'global-platform',
      videoRatio: '16:9',
      videoResolution: '480p',
      episodeDurationMode: 'per-1000-chars',
      episodeDurationValue: '120',
    })

    expect(config).toMatchObject({
      projectLevel: 'Nori1.0',
      projectStyle: 'anime-2.5d',
      targetAudience: 'global-platform',
      videoRatio: '16:9',
      videoResolution: '480p',
      episodeDurationMode: 'per-1000-chars',
      episodeDurationValue: 120,
      targetEpisodeDurationSeconds: 120,
      usesCustomArtStylePrompt: false,
    })
    expect(config.artStylePrompt).toContain('2.5D 动漫短剧风格')
    expect(config.targetAudiencePrompt).toContain('出海平台视频消费者')
  })

  it('lets a custom art style fully replace the selected built-in style', () => {
    const config = normalizeProjectCreationConfig({
      projectStyle: 'live-action',
      referenceArtStylePrompt: '参考图呈现低饱和冷灰色调与硬质侧光。',
      customArtStylePrompt: '统一为写实都市夜景风格。',
    })

    expect(config.artStylePrompt).not.toContain('Nori1.0 项目基础画风')
    expect(config.artStylePrompt).not.toContain('真人实拍电影质感')
    expect(config.artStylePrompt).toContain('参考图呈现低饱和冷灰色调')
    expect(config.artStylePrompt).toContain('统一为写实都市夜景风格')
    expect(config.artStylePrompt).toContain('用户自定义画风完全覆盖')
    expect(config.baseArtStylePrompt).toBe('')
    expect(config.usesCustomArtStylePrompt).toBe(true)
    expect(config.usesReferenceArtStylePrompt).toBe(true)
    expect(buildAssetAestheticPrompt(config.artStylePrompt)).toBe(config.artStylePrompt)
    expect(buildProjectDescription(config, null)).toContain('自定义画风')
    expect(buildProjectDescription(config, null)).not.toContain('仿真人')
  })

  it('keeps the selected built-in style when no custom style is provided', () => {
    const config = normalizeProjectCreationConfig({
      projectStyle: 'anime-2d',
      referenceArtStylePrompt: '参考图使用柔和暖色。',
    })

    expect(config.artStylePrompt).toContain('Nori1.0 项目基础画风')
    expect(config.artStylePrompt).toContain('高质量 2D 动漫短剧风格')
    expect(config.artStylePrompt).toContain('参考图使用柔和暖色')
    expect(config.baseArtStylePrompt).toContain('高质量 2D 动漫短剧风格')
  })

  it('accepts 1080p and preserves it in the project description', () => {
    const config = normalizeProjectCreationConfig({
      videoResolution: '1080p',
    })

    expect(config.videoResolution).toBe('1080p')
    expect(buildProjectDescription(config, null)).toContain(' · 1080p · ')
  })

  it('supports 4K project output and removes 3D-looking cues from live-action asset prompts', () => {
    const config = normalizeProjectCreationConfig({
      projectStyle: 'live-action',
      videoResolution: '4K',
    })
    expect(config.videoResolution).toBe('4K')
    expect(config.artStylePrompt).toContain('严格避免 3D 建模')
    expect(buildAssetAestheticPrompt(config.artStylePrompt)).toContain('不要 3D 建模、CGI、游戏引擎渲染')
    expect(buildAssetAestheticPrompt('高质量 3D 动漫短剧风格')).toBe('高质量 3D 动漫短剧风格')
  })

  it('rejects unsupported project level, enumerations and out-of-range durations', () => {
    expect(() => normalizeProjectCreationConfig({ projectLevel: '精品版2.0' }))
      .toThrow(ApiError)
    expect(() => normalizeProjectCreationConfig({ projectStyle: 'premium' }))
      .toThrow(ApiError)
    expect(() => normalizeProjectCreationConfig({ episodeDurationMode: 'per-1000-chars', episodeDurationValue: 601 }))
      .toThrow(ApiError)
  })

  it('builds the compact project description used by project cards', () => {
    const config = normalizeProjectCreationConfig({
      projectStyle: 'live-action',
      targetAudience: 'zh-platform',
      videoRatio: '9:16',
      videoResolution: '720p',
      episodeDurationMode: 'per-episode',
      episodeDurationValue: 60,
    })

    expect(buildProjectDescription(config, '测试项目')).toBe('Nori1.0 · 仿真人 · 中文平台 · 9:16 · 720p · 60s/集 · 测试项目')
  })

  it('accepts the FrameOS episode range and rejects reversed ranges', () => {
    expect(normalizeInitialEpisodeRange({ initialEpisodeStart: '3', initialEpisodeEnd: '7' }))
      .toEqual({ start: 3, end: 7, count: 5 })
    expect(normalizeInitialEpisodeRange({})).toBeNull()
    expect(() => normalizeInitialEpisodeRange({ initialEpisodeStart: 8, initialEpisodeEnd: 2 }))
      .toThrow(ApiError)
  })

  it('injects the project art style into video submission prompts once', () => {
    const first = appendProjectArtStyleConstraint('Shot 1\n画面：人物入场。', '统一低饱和冷青电影质感。')
    expect(first).toContain('项目统一画风（全局强约束）')
    expect(first).toContain('统一低饱和冷青电影质感。')
    expect(appendProjectArtStyleConstraint(first, '统一低饱和冷青电影质感。')).toBe(first)
  })
})
