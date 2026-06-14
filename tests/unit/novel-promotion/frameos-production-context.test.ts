import { describe, expect, it } from 'vitest'
import { buildFrameosProductionContext } from '@/lib/novel-promotion/frameos-production-context'

describe('buildFrameosProductionContext', () => {
  it('formats available project production fields without inventing missing values', () => {
    const context = buildFrameosProductionContext({
      project: { name: 'TEST' },
      payload: {
        projectProductionContext: {
          genre_name: 'short drama',
          language: 'zh',
          aspect_ratio: '9:16',
          episode_duration: 120,
          budget_level_name: 'standard',
        },
      },
    })

    expect(context).toContain('project_name: TEST')
    expect(context).toContain('genre: short drama')
    expect(context).toContain('language: zh')
    expect(context).toContain('aspect_ratio: 9:16')
    expect(context).toContain('budget_level: standard')
    expect(context).toContain('episode_duration_seconds: 120')
    expect(context).not.toContain('resolution:')
  })

  it('includes project creation globals for storyboard planning', () => {
    const context = buildFrameosProductionContext({
      novelProject: {
        projectLevel: 'Nori1.0',
        projectStyle: 'anime',
        targetAudience: 'global-platform',
        videoRatio: '16:9',
        videoResolution: '480p',
        targetEpisodeDurationSeconds: 90,
        artStylePrompt: '统一为现代动漫动作短剧风格。',
      },
    })

    expect(context).toContain('project_level: Nori1.0')
    expect(context).toContain('project_style: anime')
    expect(context).toContain('target_audience: global-platform')
    expect(context).toContain('target_audience_context:')
    expect(context).toContain('aspect_ratio: 16:9')
    expect(context).toContain('resolution: 480p')
    expect(context).toContain('episode_duration_seconds: 90')
    expect(context).toContain('art_style_prompt: 统一为现代动漫动作短剧风格。')
  })

  it('returns a conservative fallback when no production fields exist', () => {
    const context = buildFrameosProductionContext({})

    expect(context).toContain('No explicit project production context provided')
    expect(context).toContain('source text and asset libraries')
  })
})
