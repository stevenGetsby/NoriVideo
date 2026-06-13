import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('SuperExecutingPanel source contract', () => {
  it('shows stage-level model actions, analysis targets, outputs, quality gates and run intent', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/super-agent/SuperInputBox.tsx'),
      'utf8',
    )

    expect(source).toContain('AGENT_STAGE_INSIGHTS')
    expect(source).toContain('FALLBACK_AGENT_WORKFLOW_STAGES')
    expect(source).toContain("stageId: 'stage_7'")
    expect(source).toContain('文本模型按手动智能创作标准扩写故事并拆剧本')
    expect(source).toContain('故事扩写与剧本锁定')
    expect(source).toContain('资产 critic 核对一致性')
    expect(source).toContain('文本模型生成分镜与视频提示词')
    expect(source).toContain('视频模型生成成片片段')
    expect(source).not.toContain("stageId: 'story'")
    expect(source).not.toContain("stageId: 'script'")
    expect(source).not.toContain("stageId: 'storyboard'")
    expect(source).toContain('阶段产物')
    expect(source).toContain('实时产物')
    expect(source).toContain('buildLiveArtifactSummary')
    expect(source).toContain('资产锁定：')
    expect(source).toContain('视频模型未配置，视频生成被跳过')
    expect(source).toContain('质量检查')
    expect(source).toContain('当前创作意图')
    expect(source).toContain('runSnapshot?.run?.input?.userInput')
  })
})
