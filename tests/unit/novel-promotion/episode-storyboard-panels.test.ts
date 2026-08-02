import { describe, expect, it } from 'vitest'
import type { EpisodeStoryboardWorkflowResult } from '@/lib/novel-promotion/episode-storyboard-workflow'
import {
  buildEpisodeStoryboardClipPlans,
  EPISODE_STORYBOARD_CLIP_SOURCE,
} from '@/lib/novel-promotion/episode-storyboard-panels'

function precisePrompt(segmentId: string, character: string, location: string, prop: string) {
  return [
    segmentId,
    location,
    '8s',
    '',
    '◎ 参考资产',
    '◈ 视频提示词',
    '开场状态：',
    '环境：',
    `${location}，夜，暴雨。`,
    '站位关系：',
    `${character}：半躺在墙角。`,
    `${prop}：位于发髻中；完好。`,
    '灯光：暖黄油灯与冷青闪电形成高反差。',
    '',
    'Shot 1',
    'duration: 3.0s',
    '镜头：近景，低角度，缓慢推近，85mm。',
    '画面：',
    `${character}握紧${prop}。`,
    '光影：key:fill 约 10:1。',
    '<暴雨声>',
    '',
    '【本分镜负面要求】 不要字幕。',
    '',
    '◈ 画风描述',
    '真实古装短剧电影质感。',
  ].join('\n')
}

describe('episode storyboard panel adapter', () => {
  it('persists one clip per scene and one rich prompt panel per segment', () => {
    const workflow: EpisodeStoryboardWorkflowResult = {
      episodeNumber: 1,
      segmentFunctions: ['开场钩子', '建立情境', '情绪承载', '推进信息', '制造冲突', '交代行动', '反转钩子'],
      scenes: [{
        sceneId: 'S01',
        location: '破旧柴房',
        segmentIds: ['S01-SEG01', 'S01-SEG02'],
        totalDurationSeconds: 16,
      }],
      segments: [
        {
          segmentId: 'S01-SEG01',
          functionLabel: '开场钩子',
          sourceText: '苏晚卿从药效中惊醒。',
          location: '破旧柴房',
          durationSeconds: 8,
          emotionalIntent: '第一秒建立危险。',
          storyQuestion: '她为何在这里？',
          transitionOut: '用脚步声接到逼近。',
          characters: [{ name: '苏晚卿' }],
          props: [{ name: '银簪' }],
          narrativeEntry: '苏晚卿仍在昏迷。',
          narrativeExit: '苏晚卿从药效中惊醒。',
          shotBeats: ['苏晚卿睁开眼。'],
          videoPrompt: precisePrompt('S01-SEG01', '苏晚卿', '破旧柴房', '银簪'),
        },
        {
          segmentId: 'S01-SEG02',
          functionLabel: '制造冲突',
          sourceText: '张秃子向苏晚卿逼近。',
          location: '破旧柴房',
          durationSeconds: 8,
          emotionalIntent: '放大强弱压迫。',
          storyQuestion: '她能否逃开？',
          transitionOut: '接到银簪反击。',
          characters: [{ name: '苏晚卿' }, { name: '张秃子' }],
          props: [{ name: '银簪' }],
          narrativeEntry: '苏晚卿刚刚惊醒。',
          narrativeExit: '张秃子逼近苏晚卿。',
          shotBeats: ['张秃子向苏晚卿逼近。'],
          videoPrompt: precisePrompt('S01-SEG02', '张秃子', '破旧柴房', '银簪'),
        },
      ],
    }

    const plans = buildEpisodeStoryboardClipPlans({
      workflow,
      createClipId: () => 'clip-scene-1',
    })

    expect(plans).toHaveLength(1)
    expect(plans[0]).toEqual(expect.objectContaining({
      id: 'clip-scene-1',
      location: '破旧柴房',
      shotCount: 2,
      duration: 16,
    }))
    expect(JSON.parse(plans[0].screenplay)).toEqual(expect.objectContaining({
      source: EPISODE_STORYBOARD_CLIP_SOURCE,
      sceneId: 'S01',
    }))
    expect(plans[0].finalPanels).toHaveLength(2)
    const prompt = plans[0].finalPanels[0].video_prompt || ''
    expect(prompt).toMatch(/^开场状态：\n环境：\n/u)
    expect(prompt).toContain('站位关系：\n@苏晚卿')
    expect(prompt).toContain('@破旧柴房')
    expect(prompt).toContain('@银簪')
    expect(prompt).toContain('\nShot 1\nduration: 3.0s\n')
    expect(prompt).not.toContain('◎ 参考资产')
    expect(prompt).not.toContain('【本分镜负面要求】')
  })
})
