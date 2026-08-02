import { describe, expect, it } from 'vitest'
import { formatEpisodeScripts, formatEpisodeStoryboards, validateRepaintSetup } from '@/components/frameos/views/videoRepaintState'

describe('video repaint setup state', () => {
  it('reports every missing required setup value', () => {
    expect(validateRepaintSetup({ title: '  ', brief: '', videoCount: 0 })).toEqual({
      title: '请填写任务名称',
      videos: '请上传 1 个视频文件；当前一个视频固定作为一集处理',
    })
  })

  it('accepts exactly one video and treats adaptation requirements as optional', () => {
    expect(validateRepaintSetup({ title: '海外转绘版', brief: '', videoCount: 1 })).toEqual({})
    expect(validateRepaintSetup({ title: '海外转绘版', brief: '保留主线冲突', videoCount: 2 })).toEqual({
      videos: '请上传 1 个视频文件；当前一个视频固定作为一集处理',
    })
  })

  it('delivers the formatted episode script instead of the internal analysis JSON', () => {
    expect(formatEpisodeScripts([{ script: ' 第1集\n1-1\n场景：院落 - 白天 ' }])).toBe(
      '第1集\n1-1\n场景：院落 - 白天',
    )
  })

  it('delivers the formatted episode storyboard as a separate result', () => {
    expect(formatEpisodeStoryboards([{ storyboard: ' 第1集 · 源分镜\n\nShot 1 ' }])).toBe(
      '第1集 · 源分镜\n\nShot 1',
    )
  })
})
