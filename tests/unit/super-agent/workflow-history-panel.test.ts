import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Agent workflow history panel', () => {
  it('renders a user-readable Agent pipeline timeline with all production stages', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/AgentWorkflowHistoryPanel.tsx',
      ),
      'utf8',
    )

    expect(source).toContain('Agent Pipeline')
    expect(source).toContain('videos stage')
    expect(source).toContain('项目初始化')
    expect(source).toContain('故事扩写与剧本锁定')
    expect(source).toContain('资产一致性 Critic')
    expect(source).toContain('全局资产图生成')
    expect(source).toContain('分镜与视频提示词')
    expect(source).toContain('分镜图生成')
    expect(source).toContain('视频生成')
    expect(source).toContain('模型在分析')
    expect(source).toContain('质量门槛')
    expect(source).toContain('每个 video_prompt 必须说明哪个角色做了什么、说了什么台词')
  })

  it('keeps debug artifacts and raw json after the readable timeline', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/AgentWorkflowHistoryPanel.tsx',
      ),
      'utf8',
    )

    expect(source.indexOf('Agent Pipeline')).toBeGreaterThanOrEqual(0)
    expect(source.indexOf('Artifacts')).toBeGreaterThan(source.indexOf('Agent Pipeline'))
    expect(source).toContain('<JsonPreview value={detail.run.input} />')
    expect(source).toContain('<JsonPreview value={detail.run.output} />')
  })
})
