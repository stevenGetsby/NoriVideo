import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_REPAINT_BRIEF_CHARS,
  MAX_REPAINT_TITLE_CHARS,
  formatRepaintClock,
  outlineMissingSectionLabels,
  validateRepaintSetup,
} from '@/components/frameos/views/videoRepaintState'
import {
  writerScriptExportText,
  writerScriptUnitLabel,
  type WriterScript,
} from '@/components/frameos/views/screenwriterModels'

function source(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, '../../..', relativePath), 'utf8')
}

function script(overrides: Partial<WriterScript>): WriterScript {
  return {
    id: 'script-1',
    title: '测试剧本',
    type: '视频转绘',
    status: 'draft',
    createdAt: '刚刚',
    updatedAt: '刚刚',
    episodes: [],
    ...overrides,
  }
}

describe('video repaint writer surface', () => {
  it('embeds the repaint task in the screenwriter workbench instead of a retired entry', () => {
    const screenwriter = source('src/components/frameos/views/FosScreenwriter.tsx')
    const client = source('src/components/frameos/FosVideoRepaintClient.tsx')

    expect(screenwriter).toContain('FosVideoRepaintTask')
    expect(screenwriter).toContain('CreateCard')
    expect(screenwriter).not.toContain('视频转绘已停用')
    expect(client).toContain('/writer-workbench')
    expect(fs.existsSync(path.join(__dirname, '../../../src/components/frameos/views/videoRepaintState.ts'))).toBe(true)
  })

  it('drives one upload into target script and outline documents with optional storyboard', () => {
    const task = source('src/components/frameos/views/FosVideoRepaintTask.tsx')
    const setup = source('src/components/frameos/views/FosVideoRepaintSetup.tsx')
    const progress = source('src/components/frameos/views/FosVideoRepaintProgress.tsx')

    expect(task).toContain("'/api/video-repaint/understand'")
    expect(task).toContain("'/api/video-repaint/outline'")
    expect(task).toContain("'/api/video-repaint/script'")
    expect(task).toContain('if (generateStoryboard) void runStoryboard(source)')
    expect(task).not.toContain("'/api/video-repaint/adapt'")
    expect(task).toContain('REPAINT_MAX_STORYBOARD_ROUNDS')
    expect(task).toContain('continuation')
    expect(task).toContain('cutHints')
    expect(task).toContain('adaptationBrief')
    expect(setup).toContain('目标设定总纲')
    expect(setup).toContain('分镜')
    expect(setup).toContain('转绘需求')
    expect(setup).not.toContain('生成转绘剧本')
    expect(setup).toContain('onGenerateStoryboardChange')
    expect(progress).toContain('目标剧本')
    expect(progress).toContain('目标设定总纲')
    expect(progress).toContain('分镜')
    expect(progress).toContain('重试')
  })

  it('requires one video and a bounded task title', () => {
    expect(validateRepaintSetup({ title: '', brief: '', videoCount: 0 })).toEqual({
      title: '请填写任务名称',
      videos: '请上传 1 个视频文件；当前一个视频固定作为一集处理',
    })
    expect(validateRepaintSetup({ title: '改编第一集', brief: '保持主线', videoCount: 1 })).toEqual({})
    expect(MAX_REPAINT_TITLE_CHARS).toBe(40)
    expect(MAX_REPAINT_BRIEF_CHARS).toBe(800)
  })

  it('formats clocks and missing outline chapters', () => {
    expect(formatRepaintClock(0)).toBe('00:00')
    expect(formatRepaintClock(65.4)).toBe('01:05')
    expect(formatRepaintClock(Number.NaN)).toBe('00:00')
    expect(outlineMissingSectionLabels([2, 10, 0, 11, 1.5]))
      .toEqual(['2. 目标语言与文字系统合同', '10. 文化契合度审计'])
    expect(outlineMissingSectionLabels([])).toEqual([])
  })

  it('labels and exports documents-layout scripts while keeping the legacy episode format', () => {
    const documents = script({
      layout: 'documents',
      episodes: [
        { id: 'doc-outline', title: '目标设定总纲', body: '总纲正文' },
        { id: 'doc-storyboard', title: '分镜', body: '### SH001 [00:00.0-00:02.8]' },
      ],
    })
    expect(writerScriptUnitLabel(documents)).toBe('2 份文档')
    expect(writerScriptExportText(documents))
      .toBe('目标设定总纲\n\n总纲正文\n\n--------------------\n\n分镜\n\n### SH001 [00:00.0-00:02.8]')

    const legacy = script({ episodes: [{ id: 'ep-1', title: '雨夜', body: '正文' }] })
    expect(writerScriptUnitLabel(legacy)).toBe('1 集')
    expect(writerScriptExportText(legacy)).toBe('第 1 集  雨夜\n\n正文')
  })
})
