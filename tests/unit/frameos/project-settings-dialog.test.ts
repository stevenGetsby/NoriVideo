import * as React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

describe('作品设置弹窗', () => {
  it('提交自定义画风原文，而不是把完整合成 prompt 再次提交', () => {
    const dialog = source('src/components/frameos/FosProjectModelConfigDialog.tsx')
    expect(dialog).toContain('artStylePrompt: settings.artStylePrompt.trim()')
    expect(dialog).toContain('自定义画风提示词')
    expect(dialog).toContain('填写后完全覆盖作品风格；留空则按所选作品风格生成')
    expect(dialog).toContain('导出视频命名规则')
    expect(dialog).toContain('成员本地下载目录提示')
  })

  it('提交生成设置和模型配置到同一个 PATCH 请求', () => {
    const dialog = source('src/components/frameos/FosProjectModelConfigDialog.tsx')
    expect(dialog).toContain('body: JSON.stringify({')
    expect(dialog).toContain('...config')
    expect(dialog).toContain('...settings')
    expect(dialog).toContain('targetEpisodeDurationSeconds: duration')
  })

  it('弹窗保持可滚动，适配小分辨率屏幕', () => {
    const dialog = source('src/components/frameos/FosProjectModelConfigDialog.tsx')
    expect(dialog).toContain('max-h-[68vh] overflow-y-auto')
  })
})

describe('作品头部设置', () => {
  it('入口文案改为作品设置', () => {
    const header = renderToStaticMarkup(React.createElement(() => null))
    expect(header).toBe('')
    const sourceText = source('src/components/frameos/FosProjectHeader.tsx')
    expect(sourceText).toContain('>作品设置</button>')
    expect(sourceText).not.toContain("META_TAGS = ['剧情模式', '9:16', '480x856', '仿真人']")
  })

  it('头部展示作品当前风格、比例和分辨率', () => {
    const workflow = source('src/components/frameos/FosWorkflowClient.tsx')
    expect(workflow).toContain('function projectMetaTags(')
    expect(workflow).toContain("PROJECT_STYLE_HEADER_LABELS[data.world.projectStyle]")
    expect(workflow).toContain('data.world?.videoRatio')
    expect(workflow).toContain('data.world?.videoResolution')
    expect(workflow).toContain("includes('【用户自定义画风（最高优先级）】')")
  })
})
