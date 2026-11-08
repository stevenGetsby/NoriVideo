import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_REPAINT_TITLE_CHARS,
  formatEpisodeScripts,
  formatEpisodeStoryboards,
  validateRepaintSetup,
} from '@/components/frameos/views/videoRepaintState'

function source(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, '../../..', relativePath), 'utf8')
}

describe('video repaint writer surface', () => {
  it('embeds the repaint task in the screenwriter workbench instead of a retired entry', () => {
    const screenwriter = source('src/components/frameos/views/FosScreenwriter.tsx')
    const client = source('src/components/frameos/FosVideoRepaintClient.tsx')
    const understand = source('src/app/api/video-repaint/understand/route.ts')
    const adapt = source('src/app/api/video-repaint/adapt/route.ts')

    expect(screenwriter).toContain('FosVideoRepaintTask')
    expect(screenwriter).toContain('CreateCard')
    expect(screenwriter).not.toContain('视频转绘已停用')
    expect(client).toContain('/writer-workbench')
    expect(understand).toContain('withTextBilling')
    expect(understand).not.toContain('status: 410')
    expect(adapt).toContain('adaptVideoScript')
    expect(adapt).not.toContain('status: 410')
    expect(fs.existsSync(path.join(__dirname, '../../../src/components/frameos/views/videoRepaintState.ts'))).toBe(true)
  })

  it('requires one video and a bounded task title', () => {
    expect(validateRepaintSetup({ title: '', brief: '', videoCount: 0 })).toEqual({
      title: '请填写任务名称',
      videos: '请上传 1 个视频文件；当前一个视频固定作为一集处理',
    })
    expect(validateRepaintSetup({ title: '改编第一集', brief: '保持主线', videoCount: 1 })).toEqual({})
    expect(MAX_REPAINT_TITLE_CHARS).toBe(40)
  })

  it('keeps a readable fallback when a stage produced no script text', () => {
    expect(formatEpisodeScripts([{ script: '第1集\n场景：测试' }, { script: '' }]))
      .toBe('第1集\n场景：测试\n\n第2集\n\n未生成格式化剧本')
    expect(formatEpisodeStoryboards([{ storyboard: '第1集 · 源分镜' }, { storyboard: '  ' }]))
      .toBe('第1集 · 源分镜\n\n第2集 · 源分镜\n\n未生成格式化分镜')
  })
})
