import { describe, expect, it } from 'vitest'
import {
  EPISODE_SEGMENT_FUNCTIONS,
  buildEpisodeStoryboardWorkflowWithLlm,
} from '@/lib/novel-promotion/episode-storyboard-workflow'

describe('episode storyboard workflow', () => {
  it('uses an LLM segment plan for emotional functions and cinematic prompts', async () => {
    const input = {
      episodeNumber: 1,
      defaultLocation: '张秃子家破旧柴房',
      characters: [
        { name: '苏晚卿', appearance: '孤女逃亡时期', aliases: ['我', '她'] },
        { name: '张秃子' },
      ],
      props: [
        { name: '陈阿婆留的银簪', aliases: ['银簪'], state: '藏在发髻中，后续成为反抗武器' },
      ],
      locations: [
        { name: '张秃子家破旧柴房', aliases: ['柴房'] },
        { name: '城郊破旧土地庙', aliases: ['土地庙', '破庙'] },
      ],
      scriptText: [
        '我在破旧柴房中从药效和惊恐中醒来，意识到自己被卖给张秃子。',
        '柴房昏暗潮湿，油灯摇曳，张秃子带着浓重酒气，满脸狞笑地向我逼近。',
        '我浑身发软，额头冷汗直冒，手指徒劳地抓着潮湿地面。',
        '张秃子抓住我的手腕，说：“小美人，你娘把你卖给我还下了药，从今往后你就是我的人！”',
        '我缩手蜷身，声音发颤却藏狠劲：“放开我！就算死，我也不伺候你这个恶魔！”',
        '我趁机摸出发髻里的银簪，侧身躲开，狠狠刺向他的手臂。',
        '我拉开木门冲进瓢泼大雨，逃到城郊破旧土地庙。',
        '木门被猛地踹开，火把光刺得我睁不开眼，一双泥泞的靴子出现在门口。',
      ].join('\n'),
    }
    const planner = async (prompt: string) => {
      expect(prompt).toContain('只能使用这些 functionLabel')
      expect(prompt).toContain('情绪承载')
      expect(prompt).toContain('输出必须是纯 JSON')
      return JSON.stringify({
        segments: [
          {
            functionLabel: '开场钩子',
            sourceText: '我在破旧柴房中从药效和惊恐中醒来，意识到自己被卖给张秃子。',
            location: '张秃子家破旧柴房',
            durationSeconds: 15,
            emotionalIntent: '第一秒用药效惊醒和被卖事实抓住观众。',
            storyQuestion: '她为什么被卖到这里，张秃子马上会做什么？',
            transitionOut: '用油灯和脚步声接到压迫者逼近。',
            characterNames: ['苏晚卿'],
            propNames: ['陈阿婆留的银簪'],
          },
          {
            functionLabel: '建立情境',
            sourceText: '柴房昏暗潮湿，油灯摇曳，张秃子带着浓重酒气，满脸狞笑地向我逼近。',
            location: '张秃子家破旧柴房',
            durationSeconds: 14,
            emotionalIntent: '交代柴房空间和强弱压迫。',
            storyQuestion: '这是怎样的危险场域？',
            transitionOut: '逼近动作转入身体失控。',
            characterNames: ['苏晚卿', '张秃子'],
            propNames: ['陈阿婆留的银簪'],
          },
          {
            functionLabel: '情绪承载',
            sourceText: '我浑身发软，额头冷汗直冒，手指徒劳地抓着潮湿地面。',
            location: '张秃子家破旧柴房',
            durationSeconds: 10,
            emotionalIntent: '用身体无力、冷汗和手指细节承载恐惧。',
            storyQuestion: '她还能不能反抗？',
            transitionOut: '手腕被抓住后转入信息揭示。',
            characterNames: ['苏晚卿'],
            propNames: ['陈阿婆留的银簪'],
          },
          {
            functionLabel: '推进信息',
            sourceText: '张秃子抓住我的手腕，说：“小美人，你娘把你卖给我还下了药，从今往后你就是我的人！”',
            location: '张秃子家破旧柴房',
            durationSeconds: 12,
            emotionalIntent: '揭示被卖和下药的因果。',
            storyQuestion: '亲人背叛后她如何选择？',
            transitionOut: '信息压迫转入正面反抗台词。',
            characterNames: ['苏晚卿', '张秃子'],
            propNames: ['陈阿婆留的银簪'],
          },
          {
            functionLabel: '制造冲突',
            sourceText: '我缩手蜷身，声音发颤却藏狠劲：“放开我！就算死，我也不伺候你这个恶魔！”',
            location: '张秃子家破旧柴房',
            durationSeconds: 12,
            emotionalIntent: '让主角第一次正面对抗。',
            storyQuestion: '她的狠劲能不能换来机会？',
            transitionOut: '台词爆点落到摸出银簪。',
            characterNames: ['苏晚卿', '张秃子'],
            propNames: ['陈阿婆留的银簪'],
          },
          {
            functionLabel: '交代行动',
            sourceText: '我趁机摸出发髻里的银簪，侧身躲开，狠狠刺向他的手臂。',
            location: '张秃子家破旧柴房',
            durationSeconds: 14,
            emotionalIntent: '兑现反抗动作和道具用途。',
            storyQuestion: '这一刺能不能换来逃生窗口？',
            transitionOut: '用疼痛和门口雨声接逃离。',
            characterNames: ['苏晚卿', '张秃子'],
            propNames: ['陈阿婆留的银簪'],
          },
          {
            functionLabel: '交代行动',
            sourceText: '我拉开木门冲进瓢泼大雨，逃到城郊破旧土地庙。',
            location: '城郊破旧土地庙',
            durationSeconds: 15,
            emotionalIntent: '清楚交代逃离路线和新场景。',
            storyQuestion: '她是否真的安全了？',
            transitionOut: '用庙门和追兵火把接反转。',
            characterNames: ['苏晚卿'],
            propNames: ['陈阿婆留的银簪'],
          },
          {
            functionLabel: '反转钩子',
            sourceText: '木门被猛地踹开，火把光刺得我睁不开眼，一双泥泞的靴子出现在门口。',
            location: '城郊破旧土地庙',
            durationSeconds: 15,
            emotionalIntent: '用未知来人和局部靴子形成悬念。',
            storyQuestion: '门口是谁？是救援还是更大的危险？',
            transitionOut: '停在泥泞靴子和刺眼火光，不解释完整答案。',
            characterNames: ['苏晚卿'],
            propNames: ['陈阿婆留的银簪'],
          },
        ],
      })
    }
    const result = await buildEpisodeStoryboardWorkflowWithLlm(input, planner)

    expect(result.segmentFunctions).toEqual(EPISODE_SEGMENT_FUNCTIONS)
    expect(result.segments.length).toBeGreaterThanOrEqual(7)
    expect(result.segments.map((item) => item.functionLabel)).toEqual(expect.arrayContaining([
      '开场钩子',
      '建立情境',
      '情绪承载',
      '推进信息',
      '制造冲突',
      '交代行动',
      '反转钩子',
    ]))

    const first = result.segments[0]
    expect(first.segmentId).toBe('S01-SEG01')
    expect(first.functionLabel).toBe('开场钩子')
    expect(first.emotionalIntent).toContain('第一秒')
    expect(first.storyQuestion).toContain('为什么')
    expect(first.videoPrompt).toContain('◎ 参考资产')
    expect(first.videoPrompt).toContain('◈ 视频提示词')
    expect(first.videoPrompt).toContain('Shot 1')
    expect(first.videoPrompt).toContain('大特写')
    expect(first.videoPrompt).toContain('瞳孔骤然收缩')
    expect(first.videoPrompt).toContain('key:fill')
    expect(first.videoPrompt).toContain('◈ 画风描述')
    expect(first.videoPrompt).not.toContain('完成本段核心动作')

    const reveal = result.segments[result.segments.length - 1]
    expect(reveal.functionLabel).toBe('反转钩子')
    expect(reveal.videoPrompt).toContain('泥泞靴子')
    expect(reveal.transitionOut).toContain('不解释完整答案')
  })
})
