import { describe, expect, it } from 'vitest'
import {
  EPISODE_SEGMENT_FUNCTIONS,
  buildEpisodeStoryboardWorkflowWithLlm,
} from '@/lib/novel-promotion/episode-storyboard-workflow'
import {
  extractSeedanceVideoPromptBody,
  formatSeedancePromptForEditor,
} from '@/lib/novel-promotion/seedance-prompt-assets'

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
            onScreenCharacterNames: ['苏晚卿'],
            propNames: ['陈阿婆留的银簪'],
            narrativeEntry: '苏晚卿仍闭眼瘫在柴房墙角。',
            narrativeExit: '苏晚卿睁眼后意识到自己被卖。',
            shotBeats: [
              '苏晚卿从昏沉黑暗中猛地睁眼，瞳孔骤然收缩。',
              '她因药效浑身发软，只能在墙角急促喘息。',
              '她从陌生柴房和身体异状意识到自己已被卖。',
            ],
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
            onScreenCharacterNames: ['苏晚卿', '张秃子'],
            propNames: ['陈阿婆留的银簪'],
            narrativeEntry: '苏晚卿察觉柴房里的压迫来源。',
            narrativeExit: '张秃子带着酒气逼近苏晚卿。',
            shotBeats: [
              '昏暗潮湿的柴房里，油灯在两人之间摇曳。',
              '张秃子带着浓重酒气和狞笑一步步逼近苏晚卿。',
            ],
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
            onScreenCharacterNames: ['苏晚卿'],
            propNames: ['陈阿婆留的银簪'],
            narrativeEntry: '苏晚卿被逼到角落且药效未退。',
            narrativeExit: '她徒劳抓地仍无法起身。',
            shotBeats: [
              '苏晚卿额头冷汗直冒，身体因药效浑身发软。',
              '她的手指徒劳抓着潮湿地面，却仍无法起身。',
            ],
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
            onScreenCharacterNames: ['苏晚卿', '张秃子'],
            propNames: ['陈阿婆留的银簪'],
            narrativeEntry: '张秃子伸手控制苏晚卿。',
            narrativeExit: '苏晚卿听清自己被卖和被下药的事实。',
            shotBeats: [
              '张秃子抓住苏晚卿的手腕。',
              '张秃子说：“小美人，你娘把你卖给我还下了药，从今往后你就是我的人！”',
              '苏晚卿在被抓住的姿态中听清真相。',
            ],
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
            onScreenCharacterNames: ['苏晚卿', '张秃子'],
            propNames: ['陈阿婆留的银簪'],
            narrativeEntry: '苏晚卿仍被张秃子压制。',
            narrativeExit: '她说完拒绝服从的狠话并与他对视。',
            shotBeats: [
              '苏晚卿缩手蜷身，声音发颤却抬眼直视张秃子。',
              '她说：“放开我！就算死，我也不伺候你这个恶魔！”',
              '她说完仍强撑着没有移开视线。',
            ],
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
            onScreenCharacterNames: ['苏晚卿', '张秃子'],
            propNames: ['陈阿婆留的银簪'],
            narrativeEntry: '张秃子因对峙露出一瞬空当。',
            narrativeExit: '银簪刺中张秃子的手臂。',
            shotBeats: [
              '苏晚卿趁机摸出发髻里的银簪。',
              '她侧身躲开张秃子的动作。',
              '她将银簪狠狠刺向并命中他的手臂。',
            ],
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
            onScreenCharacterNames: ['苏晚卿'],
            propNames: ['陈阿婆留的银簪'],
            narrativeEntry: '苏晚卿获得短暂逃生窗口。',
            narrativeExit: '她逃入城郊破旧土地庙。',
            shotBeats: [
              '苏晚卿拉开柴房木门。',
              '她冲进瓢泼大雨并一路逃向城郊。',
              '她最终进入破旧土地庙。',
            ],
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
            onScreenCharacterNames: ['苏晚卿'],
            propNames: ['陈阿婆留的银簪'],
            narrativeEntry: '苏晚卿刚躲进土地庙。',
            narrativeExit: '来人的泥泞靴子停在门口，身份仍未揭晓。',
            shotBeats: [
              '土地庙木门被猛地踹开。',
              '火把光刺得苏晚卿睁不开眼。',
              '一双泥泞靴子出现在门口，画面不揭示来人身份。',
            ],
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
    expect(first.videoPrompt).toMatch(/^S01-SEG01\n/)
    expect(first.videoPrompt).toContain('◎ 参考资产')
    expect(first.videoPrompt).toContain('◈ 视频提示词')
    const editorPrompt = formatSeedancePromptForEditor(
      extractSeedanceVideoPromptBody(first.videoPrompt),
      [
        { kind: 'character', name: '苏晚卿' },
        { kind: 'location', name: '张秃子家破旧柴房' },
        { kind: 'prop', name: '陈阿婆留的银簪' },
      ],
    )
    expect(editorPrompt).toMatch(/^开场状态：\n/)
    expect(editorPrompt).toContain('环境：\n@张秃子家破旧柴房')
    expect(editorPrompt).toContain('站位关系：')
    expect(editorPrompt).toContain('@苏晚卿')
    expect(editorPrompt).toContain('@陈阿婆留的银簪')
    expect(editorPrompt).toContain('Shot 1')
    expect(editorPrompt).toContain('大特写')
    expect(editorPrompt).toContain('瞳孔骤然收缩')
    expect(editorPrompt).toContain('key:fill')
    expect(first.videoPrompt).not.toContain('摸出发髻里的银簪')
    expect(first.videoPrompt).not.toContain('狠狠刺向他的手臂')
    expect(editorPrompt).not.toContain('◈ 画风描述')
    expect(editorPrompt).not.toContain('【本分镜负面要求】')
    expect(editorPrompt).not.toContain('完成本段核心动作')

    const reveal = result.segments[result.segments.length - 1]
    expect(reveal.functionLabel).toBe('反转钩子')
    expect(reveal.videoPrompt).toContain('泥泞靴子')
    expect(reveal.transitionOut).toContain('不解释完整答案')
  })

  it('carries the prior ending state and an exact appearance id into the next segment', async () => {
    const result = await buildEpisodeStoryboardWorkflowWithLlm({
      episodeNumber: 2,
      scriptText: '苏晚卿从墙角起身。她右手握住银簪，转身冲向木门。',
      defaultLocation: '破旧柴房',
      locations: [{ name: '破旧柴房' }],
      characters: [{
        name: '苏晚卿',
        appearanceOptions: [
          { id: 'appearance-main', label: '初始形象', isPrimary: true },
          { id: 'appearance-rain', label: '雨夜逃亡', coverageEpisodes: [2] },
        ],
      }],
      props: [{ name: '银簪', state: '完好' }],
    }, async (prompt) => {
      expect(prompt).toContain('同场景中 segment[i].openingState')
      expect(prompt).toContain('雨夜逃亡[覆盖2]')
      return JSON.stringify({
        segments: [
          {
            functionLabel: '交代行动',
            sourceText: '苏晚卿从墙角起身。',
            location: '破旧柴房',
            durationSeconds: 6,
            emotionalIntent: '从瘫软状态恢复行动。',
            storyQuestion: '她能否及时逃走？',
            transitionOut: '右手握簪，身体转向木门。',
            characterNames: ['苏晚卿'],
            onScreenCharacterNames: ['苏晚卿'],
            characterAppearances: { 苏晚卿: '雨夜逃亡' },
            propNames: ['银簪'],
            narrativeEntry: '苏晚卿半跪在墙角。',
            narrativeExit: '苏晚卿站起并面向门口。',
            shotBeats: ['苏晚卿从墙角撑地起身。', '她站稳后面向木门。'],
            openingState: '苏晚卿半跪在墙角，面向门口，右手空着。',
            endingState: '苏晚卿站起并面向门口，右手握住银簪。',
            cameraAxis: '墙角到木门，苏晚卿保持画面左侧向右运动。',
          },
          {
            functionLabel: '制造冲突',
            sourceText: '她右手握住银簪，转身冲向木门。',
            location: '破旧柴房',
            durationSeconds: 7,
            emotionalIntent: '让逃跑动作快速兑现。',
            storyQuestion: '门外是否还有危险？',
            transitionOut: '停在木门被推开的瞬间。',
            characterNames: ['苏晚卿'],
            onScreenCharacterNames: ['苏晚卿'],
            characterAppearances: { 苏晚卿: '雨夜逃亡' },
            propNames: ['银簪'],
            narrativeEntry: '苏晚卿已经站起并面向门口。',
            narrativeExit: '苏晚卿右手握簪冲到木门前。',
            shotBeats: ['苏晚卿右手握住银簪。', '她转身冲向木门。'],
            openingState: '苏晚卿靠近门口。',
            endingState: '苏晚卿右手仍握银簪，左手推开木门。',
            cameraAxis: '墙角到木门，苏晚卿保持画面左侧向右运动。',
          },
        ],
      })
    })

    expect(result.segments[0].characters[0]).toEqual({
      name: '苏晚卿',
      appearance: '雨夜逃亡',
      appearanceId: 'appearance-rain',
    })
    expect(result.segments[1].previousEndState).toBe('苏晚卿站起并面向门口，右手握住银簪。')
    expect(result.segments[1].openingState).toContain('苏晚卿站起并面向门口，右手握住银簪。')
    expect(result.segments[1].videoPrompt).toContain('第一帧严格复现上一分镜尾帧')
    expect(result.segments[1].videoPrompt).toContain('相邻镜头之间禁止角色瞬移、换手、换装')
  })

  it('rejects future剧情 leakage and retries with shot beats confined to the current segment', async () => {
    const scriptText = '苏晚卿在柴房墙角惊醒。张秃子逼近并抓住她的手腕。苏晚卿随后摸出银簪刺向他的手臂。'
    let calls = 0
    const result = await buildEpisodeStoryboardWorkflowWithLlm({
      episodeNumber: 1,
      scriptText,
      defaultLocation: '破旧柴房',
      locations: [{ name: '破旧柴房' }],
      characters: [{ name: '苏晚卿' }, { name: '张秃子' }],
      props: [{ name: '银簪', state: '藏在发髻中' }],
    }, async (_prompt, attempt) => {
      calls += 1
      const leaked = attempt === 1
      return JSON.stringify({
        segments: [
          {
            functionLabel: '开场钩子',
            sourceText: '苏晚卿在柴房墙角惊醒。',
            location: '破旧柴房',
            durationSeconds: 6,
            emotionalIntent: '建立苏晚卿突然惊醒的危险感。',
            storyQuestion: '她为何身处柴房？',
            transitionOut: '用逼近的脚步声接下一段。',
            characterNames: ['苏晚卿'],
            onScreenCharacterNames: ['苏晚卿'],
            propNames: ['银簪'],
            narrativeEntry: '苏晚卿闭眼倒在墙角。',
            narrativeExit: '苏晚卿在柴房墙角惊醒。',
            shotBeats: leaked
              ? ['苏晚卿睁眼。', '苏晚卿随后摸出银簪刺向他的手臂。']
              : ['苏晚卿在墙角猛地睁眼。'],
          },
          {
            functionLabel: '制造冲突',
            sourceText: '张秃子逼近并抓住她的手腕。',
            location: '破旧柴房',
            durationSeconds: 7,
            emotionalIntent: '让身体压迫具体发生。',
            storyQuestion: '苏晚卿能否挣脱？',
            transitionOut: '抓腕动作留下反击窗口。',
            characterNames: ['苏晚卿', '张秃子'],
            onScreenCharacterNames: ['苏晚卿', '张秃子'],
            propNames: ['银簪'],
            narrativeEntry: '张秃子走到苏晚卿面前。',
            narrativeExit: '张秃子抓住苏晚卿的手腕。',
            shotBeats: ['张秃子向苏晚卿逼近。', '他抓住她的手腕。'],
          },
          {
            functionLabel: '交代行动',
            sourceText: '苏晚卿随后摸出银簪刺向他的手臂。',
            location: '破旧柴房',
            durationSeconds: 8,
            emotionalIntent: '兑现苏晚卿的反击。',
            storyQuestion: '她能否借机逃脱？',
            transitionOut: '停在银簪命中手臂的结果。',
            characterNames: ['苏晚卿', '张秃子'],
            onScreenCharacterNames: ['苏晚卿', '张秃子'],
            propNames: ['银簪'],
            narrativeEntry: '苏晚卿的手腕仍被抓住。',
            narrativeExit: '银簪刺中张秃子的手臂。',
            shotBeats: ['苏晚卿摸出银簪。', '她将银簪刺向张秃子的手臂。'],
          },
        ],
      })
    })

    expect(calls).toBe(2)
    expect(result.segments[0].videoPrompt).not.toContain('摸出银簪刺向')
    expect(result.segments[0].shotBeats).toEqual(['苏晚卿在墙角猛地睁眼。'])
  })

  it('does not bind a dialogue-only mentioned character as an on-screen asset', async () => {
    const result = await buildEpisodeStoryboardWorkflowWithLlm({
      episodeNumber: 2,
      scriptText: '苏晚卿独自在土地庙低声说：“阿婆，我不能死，我还要回去找你。”',
      defaultLocation: '城郊破旧土地庙',
      locations: [{ name: '城郊破旧土地庙' }],
      characters: [{ name: '苏晚卿' }, { name: '陈阿婆', aliases: ['阿婆'] }],
    }, async () => JSON.stringify({
      segments: [{
        functionLabel: '情绪承载',
        sourceText: '苏晚卿独自在土地庙低声说：“阿婆，我不能死，我还要回去找你。”',
        location: '城郊破旧土地庙',
        durationSeconds: 8,
        emotionalIntent: '用低语表现她的求生信念。',
        storyQuestion: '她能否活着回去？',
        transitionOut: '低语结束后听见庙外异响。',
        characterNames: ['苏晚卿', '陈阿婆'],
        onScreenCharacterNames: ['苏晚卿'],
        propNames: [],
        narrativeEntry: '苏晚卿独自缩在土地庙内。',
        narrativeExit: '苏晚卿说完要活着回去找阿婆。',
        shotBeats: ['苏晚卿独自在土地庙低声说：“阿婆，我不能死，我还要回去找你。”'],
      }],
    }))

    expect(result.segments[0].characters).toHaveLength(1)
    expect(result.segments[0].characters[0]).toEqual(expect.objectContaining({ name: '苏晚卿' }))
    expect(result.segments[0].videoPrompt).not.toContain('陈阿婆')
  })
})
