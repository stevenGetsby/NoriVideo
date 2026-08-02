import { describe, expect, it } from 'vitest'
import {
  normalizeProjectStyleAnalysisText,
  PROJECT_STYLE_ANALYSIS_PROMPT,
} from '@/lib/projects/style-reference-analysis'

describe('project style reference analysis', () => {
  it('asks for reusable visual style rather than reference-image story content', () => {
    expect(PROJECT_STYLE_ANALYSIS_PROMPT).toContain('资产图、分镜图和视频生成')
    expect(PROJECT_STYLE_ANALYSIS_PROMPT).toContain('不复述具体人物身份')
    expect(PROJECT_STYLE_ANALYSIS_PROMPT).toContain('跨镜一致性')
  })

  it('normalizes fenced model output into an editable plain prompt', () => {
    expect(normalizeProjectStyleAnalysisText('```text\n画风提示词：低饱和冷灰电影光影。\n```'))
      .toBe('低饱和冷灰电影光影。')
  })
})
