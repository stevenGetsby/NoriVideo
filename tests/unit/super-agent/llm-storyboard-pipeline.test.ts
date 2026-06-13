import { describe, expect, it } from 'vitest'
import { __agentLlmStoryboardPipelineTestHooks as hooks } from '@/lib/super-agent/llm-storyboard-pipeline'

describe('agent LLM storyboard pipeline normalization', () => {
  const plan = {
    projectConfig: {
      name: 'Agent 测试项目',
      videoRatio: '9:16',
      artStyle: 'storybook',
      artStylePrompt: '可爱童话风，温暖夜色，柔和月光',
    },
    creativeParameters: {
      durationSeconds: 24,
      shotCount: 5,
      panelsPerShot: 2,
      narration: 'auto',
    },
  } as any

  it('normalizes assets, clips, and clean variable-duration video prompts', () => {
    const stage2 = hooks.normalizeStage2Response(JSON.stringify({
      assets: {
        characters: [
          {
            name: 'Ava',
            aliases: ['Ava'],
            summary: 'young American woman, anxious but stubborn',
            visual: 'black frame glasses, low ponytail, cream cardigan',
          },
          {
            name: 'Dr. Grayson',
            summary: 'American surgeon, restrained and cold',
            visual: 'white coat, dark shirt, professional pressure',
          },
        ],
        locations: [
          {
            name: 'modern American private hospital corridor',
            summary: 'white walls, blue guide stripe, English signs',
            visual: 'cold overhead light, operating room doors, waiting chairs',
          },
        ],
        props: [
          {
            name: 'surgery schedule document',
            summary: 'used by Ava to request surgery arrangement',
            visual: 'white medical paperwork folder',
          },
        ],
      },
      clips: [
        {
          clipIndex: 1,
          title: 'Ava asks for help',
          summary: 'Ava asks Dr. Grayson to arrange surgery for her grandmother.',
          location: 'modern American private hospital corridor',
          characters: ['Ava', 'Dr. Grayson'],
          props: ['surgery schedule document'],
          duration: 7,
          content: 'Ava approaches Dr. Grayson with wet eyes and asks for help.',
          screenplay: {
            beats: ['approach', 'request', 'reaction'],
            dialogue: ['Ava: Please, doctor. She cannot wait.'],
          },
        },
      ],
    }))

    const panels = hooks.normalizeStage3Response(JSON.stringify({
      panels: [
        {
          clipIndex: 1,
          panelIndex: 1,
          summary: 'Ava asks Dr. Grayson to arrange surgery.',
          location: 'modern American private hospital corridor',
          characters: ['Ava', 'Dr. Grayson'],
          props: ['surgery schedule document'],
          shotType: 'medium to close-up',
          cameraMove: 'fixed with slight push-in',
          duration: 7,
          video_prompt: [
            '场景：现代美国私立医院走廊。',
            '剧情片段：Ava asks Dr. Grayson to arrange surgery.',
            '执行要求：严格执行本 video_prompt，不要改写故事含义，不要替换角色资产，不要把本分镜简化成单张静态图。',
            '本分镜使用资产：角色=Ava、Dr. Grayson；场景=modern American private hospital corridor；道具=surgery schedule document。',
            '角色行为拆分：Ava：approaches with wet eyes and speaks softly；Dr. Grayson：listens without moving.',
            '人物站位：Ava in foreground, Dr. Grayson in middle ground.',
            '镜头语言：medium shot to close-up, fixed with slight push-in.',
            '0-3s：medium shot, Ava steps closer and lifts the document.',
            '3-7s：close-up, Ava says: "Please, doctor. She cannot wait." English lip sync.',
            '对应原文：this line must be stripped',
          ].join('\n'),
        },
      ],
    }), stage2.clips)

    expect(stage2.characters.map((item) => item.name)).toEqual(['Ava', 'Dr. Grayson'])
    expect(stage2.clips).toHaveLength(1)
    expect(panels).toHaveLength(1)
    expect(panels[0].duration).toBe(7)
    expect(panels[0].videoPrompt).toContain('0-3s：')
    expect(panels[0].videoPrompt).toContain('3-7s：')
    expect(panels[0].videoPrompt).toContain('【本分镜负面要求】')
    expect(panels[0].videoPrompt).not.toContain('对应原文')
  })

  it('does not append fallback timed lines when LLM uses 秒-based timing', () => {
    const stage2 = hooks.normalizeStage2Response(JSON.stringify({
      assets: {
        characters: [{ name: 'Ava', summary: 'anxious family member', visual: 'black glasses, cream cardigan' }],
        locations: [{ name: 'hospital corridor', summary: 'night corridor', visual: 'English hospital signs' }],
        props: [{ name: 'surgery document', summary: 'medical proof', visual: 'printed file' }],
      },
      clips: [{
        clipIndex: 1,
        title: 'Record proof',
        summary: 'Ava proves the record was changed.',
        location: 'hospital corridor',
        characters: ['Ava'],
        props: ['surgery document'],
        duration: 6,
        content: 'Ava points to the timestamp.',
        screenplay: {
          beats: ['Ava flips the document.', 'Ava points to the timestamp.'],
          dialogue: ['Ava: Someone changed the record.'],
        },
      }],
    }))

    const panels = hooks.normalizeStage3Response(JSON.stringify({
      panels: [{
        clipIndex: 1,
        panelIndex: 1,
        summary: 'Ava proves the record was changed.',
        location: 'hospital corridor',
        characters: ['Ava'],
        props: ['surgery document'],
        duration: 6,
        video_prompt: [
          '场景：hospital corridor。',
          '剧情片段：Ava proves the record was changed.',
          '执行要求：严格执行本 video_prompt，不要改写故事含义，不要替换角色资产，不要把本分镜简化成单张静态图。',
          '本分镜使用资产：角色=Ava；场景=hospital corridor；道具=surgery document。',
          '角色行为拆分：Ava flips the document and points to the timestamp.',
          '人物站位：Ava stands in the foreground.',
          '镜头语言：close-up, fixed.',
          '按秒拆分的动作/台词行：0-1.5秒，Ava翻开文件；1.5-4秒，Ava英文口型同步说：Someone changed the record；4-6秒，Ava指向时间戳。',
          '【本分镜负面要求】不要中文字幕，不要背景音乐。',
        ].join('\n'),
      }],
    }), stage2.clips)

    expect(panels[0].videoPrompt.match(/\n0-2s：/g)).toBeNull()
    expect(panels[0].videoPrompt).toContain('0-1.5秒')
    expect(panels[0].videoPrompt).toContain('4-6秒')
  })

  it('generates validated SH shot script before building video prompts from a short story', async () => {
    const validShotScript = [
      '## S1 [月光森林小路] 角色：小兔子 / 萤火虫',
      '### SH001 [00:00-00:04]',
      '景别：中景',
      '机位：平视',
      '运镜：固定',
      '画面：小兔子提着小篮子走在月光森林小路上，远处水坑反着银色月光。',
      '角色：小兔子',
      '动作：小兔子放慢脚步，听见细小的扑水声后转头。',
      '微表情：耳朵轻轻竖起，眼神好奇又担心。',
      '对白/字幕：（空）',
      '光影：柔和月光穿过树叶，地面有细碎光斑。',
      '声音/剪辑：夜晚虫鸣和轻微脚步声。',
      '道具：小篮子',
      '### SH002 [00:04-00:08]',
      '景别：近景',
      '机位：低机位',
      '运镜：轻微推近',
      '画面：一只萤火虫落在小水坑边缘，翅膀沾湿发出微弱光点。',
      '角色：萤火虫 / 小兔子',
      '动作：小兔子蹲下，把一片宽树叶慢慢伸向萤火虫。',
      '微表情：小兔子眼神温柔，萤火虫显得慌张。',
      '对白/字幕：（对口型）小兔子: 别怕，我来帮你。',
      '光影：萤火虫暖黄色微光映在树叶边缘。',
      '声音/剪辑：水面轻响，树叶摩擦声。',
      '道具：树叶 / 小水坑',
      '### SH003 [00:08-00:13]',
      '景别：特写',
      '机位：平视',
      '运镜：固定',
      '画面：萤火虫站上树叶，小兔子轻轻把它托离水坑。',
      '角色：小兔子 / 萤火虫',
      '动作：小兔子屏住呼吸抬起树叶，萤火虫抖掉水珠重新发光。',
      '微表情：小兔子松了一口气，萤火虫开心地眨着光。',
      '对白/字幕：（空）',
      '光影：暖黄光和冷蓝月光交织，水珠闪亮。',
      '声音/剪辑：水珠落回水坑的细小声音。',
      '道具：树叶',
      '### SH004 [00:13-00:18]',
      '景别：近景',
      '机位：平视',
      '运镜：轻微推近',
      '画面：萤火虫围着小兔子飞了一圈，一颗像月亮的小光球落在小兔子手心。',
      '角色：小兔子 / 萤火虫',
      '动作：萤火虫挥动翅膀，小兔子双手接住月亮灯。',
      '微表情：小兔子惊喜地睁大眼睛。',
      '对白/字幕：（对口型）萤火虫: 谢谢你，我送你一盏月亮灯吧。',
      '光影：月亮灯发出温柔银黄色光晕。',
      '声音/剪辑：轻柔闪光声和翅膀振动声。',
      '道具：月亮灯',
      '### SH005 [00:18-00:24]',
      '景别：全景',
      '机位：平视',
      '运镜：缓慢跟随',
      '画面：小兔子提着月亮灯走在森林路口，为迷路的小动物照亮回家的方向。',
      '角色：小兔子',
      '动作：小兔子举起月亮灯，朝远处温柔招手。',
      '微表情：小兔子微笑，眼神坚定。',
      '对白/字幕：（画外）旁白: 善良的人，就像一盏会发光的灯。',
      '光影：月亮灯照亮前方小路，森林边缘保持夜蓝色。',
      '声音/剪辑：脚步声、远处动物轻声回应。',
      '道具：月亮灯',
    ].join('\n')

    let calls = 0
    const script = await hooks.generateValidatedShotScript({
      sourceText: '一天晚上，小兔子在森林里散步，救起掉进水坑的萤火虫，后来得到月亮灯并帮助迷路的小动物。',
      plan,
      callLlm: async () => {
        calls += 1
        return validShotScript
      },
    })
    const validation = hooks.validateShotScriptText(script)
    const stage2 = hooks.buildShotSheetStage2Result(script)

    expect(calls).toBe(1)
    expect(validation.ok).toBe(true)
    expect(validation.shots).toHaveLength(5)
    expect(stage2?.clips.length).toBeGreaterThan(0)
    expect(Math.max(...(stage2?.clips.map((clip: any) => clip.duration) || [0]))).toBeLessThanOrEqual(15)
    expect(stage2?.clips[0].content).toContain('执行要求：严格执行本 video_prompt')
    expect(stage2?.clips[0].content).toContain('本分镜使用资产：')
    expect(stage2?.clips[0].content).toContain('【本分镜负面要求】')
  })
})
