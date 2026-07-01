import { describe, expect, it } from 'vitest'
import { ensureAgentPanelVideoPrompt } from '@/lib/super-agent/panel-video-prompt'
import { buildPreciseBeatVideoPrompt } from '@/lib/novel-promotion/short-drama-video-prompt'

describe('ensureAgentPanelVideoPrompt', () => {
  it('converts a plain panel prompt into one precise segment video prompt', () => {
    const result = ensureAgentPanelVideoPrompt({
      panelNumber: 2,
      description: 'Nori Cube 在工作台上亮起，流程光带汇聚成视频缩略画面。',
      location: '现代极简工作台',
      props: JSON.stringify(['Nori Cube']),
      shotType: '低机位近景',
      cameraMove: '缓缓推近',
      videoPrompt: 'Nori Cube 内部蓝白光从暗到亮。',
      duration: 8,
      clipContent: '不要真人、不要人脸、不要背景音乐。',
    })

    expect(result.changed).toBe(true)
    expect(result.duration).toBe(8)
    expect(result.videoPrompt).toMatch(/^S01-SEG02\n现代极简工作台\n8s/)
    expect(result.videoPrompt).toContain('◎ 参考资产')
    expect(result.videoPrompt).toContain('角色\n无')
    expect(result.videoPrompt).toContain('物品\nNori Cube')
    expect(result.videoPrompt).toContain('◈ 一致性控制')
    expect(result.videoPrompt).toContain('◈ 视频提示词')
    expect(result.videoPrompt).toContain('开场状态：')
    expect(result.videoPrompt).toContain('Shot 1')
    expect(result.videoPrompt).toContain('duration:')
    expect(result.videoPrompt).toContain('镜头：')
    expect(result.videoPrompt).toContain('画面：')
    expect(result.videoPrompt).toContain('光影：')
    expect(result.videoPrompt).not.toContain('【Agent 视频分镜提示词】')
    expect(result.videoPrompt).not.toContain('本 panel 动作/台词')
    expect(result.videoPrompt).not.toContain('视频提示：')
    expect(result.videoPrompt).toContain('不要真人、不要人脸')
    expect(result.videoPrompt).toContain('不要生成背景音乐')
  })

  it('keeps an existing precise segment prompt', () => {
    const prompt = buildPreciseBeatVideoPrompt({
      segmentId: 'S01-SEG01',
      location: '现代美国私立医院',
      beat: 'Ava 请求 Dr. Grayson 安排手术。',
      durationSeconds: 4,
      characters: [{ name: 'Ava' }, { name: 'Dr. Grayson' }],
      props: [{ name: '手术安排文件' }],
    })
    const result = ensureAgentPanelVideoPrompt({
      videoPrompt: prompt,
      duration: 4,
    })

    expect(result.changed).toBe(false)
    expect(result.videoPrompt).toBe(prompt)
  })

  it('converts legacy double Agent wrappers into the precise segment format', () => {
    const legacy = [
      '【Agent 视频分镜提示词】',
      '【片段内分镜1｜推荐时长：4秒】',
      '场景：现代美国私立医院',
      '本 panel 动作/台词：0-4s：Ava 请求 Dr. Grayson 安排手术。',
      '视频提示：旧 canonical prompt',
      '【本分镜负面要求】不要生成乱码文字。',
    ].join('\n')

    const result = ensureAgentPanelVideoPrompt({
      videoPrompt: legacy,
      duration: 4,
    })

    expect(result.changed).toBe(true)
    expect(result.videoPrompt).toMatch(/^S01-SEG01\n/)
    expect(result.videoPrompt).toContain('◎ 参考资产')
    expect(result.videoPrompt).toContain('◈ 视频提示词')
    expect(result.videoPrompt).toContain('Shot 1')
    expect(result.videoPrompt).not.toContain('【Agent 视频分镜提示词】')
    expect(result.videoPrompt).not.toContain('本 panel 动作/台词')
    expect(result.videoPrompt).not.toContain('视频提示：')
  })
})
