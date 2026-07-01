import { describe, expect, it } from 'vitest'
import { getPanelAssetUsage } from '@/lib/novel-promotion/panel-asset-usage'
import { runScriptToStoryboardOrchestrator } from '@/lib/novel-promotion/script-to-storyboard/orchestrator'
import { buildCompressedAgentPrompt } from '@/lib/novel-promotion/short-drama-video-prompt'
import { runStoryToScriptOrchestrator } from '@/lib/novel-promotion/story-to-script/orchestrator'
import { buildAgentStoryPackage, serializeAgentStoryPackage } from '@/lib/super-agent/agent-story-package'
import type { LLMAnalysisResult } from '@/lib/super-agent/types'

function buildShot(number: number, start: number, end: number) {
  const code = String(number).padStart(3, '0')
  const mmss = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return [
    `### SH${code} [${mmss(start)}-${mmss(end)}]`,
    '景别：中景',
    '机位：平视',
    '运镜：固定',
    `画面：Ava 与 Dr. Grayson 执行第 ${number} 个短剧镜头。`,
    '角色：Ava / Dr. Grayson',
    '动作：Ava 抬头，Dr. Grayson 保持冷静',
    '微表情：眼神紧张',
    number % 4 === 0 ? '对白/字幕：(对口型) Ava: Test line.' : '对白/字幕：（空）',
    '光影：冷白顶灯',
    '声音/剪辑：（空）',
  ].join('\n')
}

function buildMedicalFiftyShotFixture() {
  const parts = [
    '《测试》',
    '## S1 [高级私立医院走廊 · 日 · 内] 角色：Ava / Dr. Grayson / Nurse Sarah',
  ]
  let seconds = 0
  for (let i = 1; i <= 50; i += 1) {
    if (i === 15) parts.push('## S2 [高科技手术室 · 日 · 内] 角色：Dr. Grayson / Nurse Sarah')
    if (i === 20) parts.push('## S3 [外科洗手间/更衣室 · 日 · 内] 角色：Dr. Grayson / Dr. Carter')
    if (i === 25) parts.push('## S4 [ICU外走廊 · 日 · 内] 角色：Dr. Grayson / Dr. Carter / Ava')
    parts.push(buildShot(i, seconds, seconds + 2))
    seconds += 2
  }
  return parts.join('\n')
}

function expectPreciseSegmentPrompt(text: string | undefined) {
  expect(text).toBeTruthy()
  expect(text).toMatch(/^S\d{2}-SEG\d{2}\n/)
  expect(text).toContain('◎ 参考资产')
  expect(text).toContain('◎ 输出参数')
  expect(text).toContain('◈ 一致性控制')
  expect(text).toContain('◈ 视频提示词')
  expect(text).toContain('开场状态：')
  expect(text).toContain('站位关系：')
  expect(text).toContain('Shot 1')
  expect(text).toContain('duration:')
  expect(text).toContain('镜头：')
  expect(text).toContain('画面：')
  expect(text).toContain('光影：')
  expect(text).toContain('【本分镜负面要求】')
  expect(text).not.toContain('剧情片段：')
  expect(text).not.toContain('角色行为拆分：')
}

describe('short-drama Agent fast path', () => {
  const shortDramaBriefPrompt = [
    '请用 Agent 自动创作模式生成一支 9:16 欧美医疗短剧转绘视频，真实真人短剧质感，英文口型，不要中文字幕，不要背景音乐。',
    '工作流必须先抽取并锁定全局资产，再按剧情片段生成分镜；每个视频分镜要包含场景、人物站位、镜头语言、按秒拆分的动作/对白和全局负面要求。',
    '角色资产：',
    'Ava：年轻美国女性，24-27 岁，黑框眼镜，低马尾或微乱浅棕发，奶白色针织开衫和白色内搭；焦急、委屈、脆弱但倔强，眼神湿润，有熬夜疲惫感。',
    'Dr. Grayson：美国男外科医生，30-34 岁，深棕色短发，轮廓分明，冷静克制；白大褂版本穿白色医生大褂和深色衬衫，手术服版本穿绿色手术服、手术帽、口罩和无菌手套；气质专业、高冷、有压迫感。',
    'Nurse Sarah：美国注册护士，30-40 岁，浅蓝色护士服，医用口罩，职业感强，眼神严厉，语速快，带质疑和指责感。',
    'Dr. Carter：美国男医生，30-35 岁，白大褂，浅色衬衫或浅色 scrub，短发，外向八卦，表情轻松，负责调侃和喜剧感。',
    '剧情：Ava 在医院走廊请求 Dr. Grayson 帮外婆安排手术，却被 Nurse Sarah 质疑钱的来源。Dr. Grayson 冷静维护 Ava，并亲自完成手术。术后 Dr. Carter 发现 Ava 和 Dr. Grayson 之间的暧昧痕迹，识趣离开。Ava 感谢手术成功，Dr. Grayson 质问她是否故意接近自己，最后逼近她留下悬念。',
  ].join('\n')

  it('story-to-script turns role assets plus a short plot into refined prompt clips', async () => {
    let llmCalls = 0
    const result = await runStoryToScriptOrchestrator({
      content: shortDramaBriefPrompt,
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '',
        locationPromptTemplate: '',
        propPromptTemplate: '',
        clipPromptTemplate: '',
        screenplayPromptTemplate: '',
      },
      runStep: async () => {
        llmCalls += 1
        throw new Error('LLM should not be called for short-drama brief fast path')
      },
    })

    expect(llmCalls).toBe(0)
    expect(result.summary.clipCount).toBeGreaterThanOrEqual(4)
    expect(result.analyzedCharacters.map((item) => item.name)).toEqual([
      'Ava',
      'Dr. Grayson',
      'Nurse Sarah',
      'Dr. Carter',
    ])
    expectPreciseSegmentPrompt(result.clipList[0].content)
    expect(result.clipList[0].content).not.toContain('【短剧角色资产保持不变】')
    expect(result.clipList[0].content).toContain('角色\nAva')
    expect(result.clipList[0].content).toMatch(/\nShot 2\n/)
  })

  it('script-to-storyboard keeps refined brief clips as final video-ready panels', async () => {
    const storyResult = await runStoryToScriptOrchestrator({
      content: shortDramaBriefPrompt,
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '',
        locationPromptTemplate: '',
        propPromptTemplate: '',
        clipPromptTemplate: '',
        screenplayPromptTemplate: '',
      },
      runStep: async () => {
        throw new Error('LLM should not be called for short-drama brief fast path')
      },
    })

    const storyboardResult = await runScriptToStoryboardOrchestrator({
      clips: storyResult.clipList.map((clip) => ({
        id: clip.id,
        content: clip.content,
        characters: JSON.stringify(clip.characters),
        location: clip.location,
        props: JSON.stringify(clip.props),
        screenplay: null,
      })),
      novelPromotionData: {
        characters: storyResult.analyzedCharacters.map((item) => ({ name: String(item.name) })),
        locations: storyResult.analyzedLocations.map((item) => ({ name: String(item.name) })),
        props: [],
      },
      promptTemplates: {
        phase1PlanTemplate: '',
        phase2CinematographyTemplate: '',
        phase2ActingTemplate: '',
        phase3DetailTemplate: '',
      },
      runStep: async () => {
        throw new Error('LLM should not be called for prepared short-drama prompt clips')
      },
    })

    expect(storyboardResult.summary.totalPanelCount).toBe(storyResult.summary.clipCount)
    expect(storyboardResult.clipPanels[0].finalPanels).toHaveLength(1)
    const firstPanel = storyboardResult.clipPanels[0].finalPanels[0]
    expectPreciseSegmentPrompt(firstPanel.video_prompt)
    expect(firstPanel.video_prompt).not.toContain('【短剧角色资产保持不变】')
    expect(firstPanel.video_prompt).toContain('英文口型同步')
    expect(firstPanel.video_prompt).not.toContain('本 panel 角色行为约束')
    expect(firstPanel.video_prompt).toMatch(/\nShot 2\n/)
    expect(firstPanel.duration).toBeGreaterThan(1)
  })

  it('story-to-script turns SH shot sheets into 15 deterministic prompt clips without LLM calls', async () => {
    let llmCalls = 0
    const result = await runStoryToScriptOrchestrator({
      content: buildMedicalFiftyShotFixture(),
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '',
        locationPromptTemplate: '',
        propPromptTemplate: '',
        clipPromptTemplate: '',
        screenplayPromptTemplate: '',
      },
      runStep: async () => {
        llmCalls += 1
        throw new Error('LLM should not be called for SH shot-sheet fast path')
      },
    })

    expect(llmCalls).toBe(0)
    expect(result.summary.clipCount).toBe(15)
    expect(result.summary.screenplayFailedCount).toBe(0)
    expectPreciseSegmentPrompt(result.clipList[0].content)
    expect(result.clipList[0].content).not.toContain('来源镜头：SH001-SH004')
    expect(result.clipList[14].content).not.toContain('来源镜头：SH048-SH050')
    expect(result.analyzedCharacters.map((item) => item.name)).toContain('Ava')
    expect(result.analyzedLocations.map((item) => item.name)).toContain('高科技手术室 · 日 · 内')
  })

  it('script-to-storyboard persists deterministic prompt clips as one video-ready panel each', async () => {
    const storyResult = await runStoryToScriptOrchestrator({
      content: buildMedicalFiftyShotFixture(),
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '',
        locationPromptTemplate: '',
        propPromptTemplate: '',
        clipPromptTemplate: '',
        screenplayPromptTemplate: '',
      },
      runStep: async () => {
        throw new Error('LLM should not be called for SH shot-sheet fast path')
      },
    })

    let storyboardLlmCalls = 0
    const storyboardResult = await runScriptToStoryboardOrchestrator({
      clips: storyResult.clipList.map((clip) => ({
        id: clip.id,
        content: clip.content,
        characters: JSON.stringify(clip.characters),
        location: clip.location,
        props: JSON.stringify(clip.props),
        screenplay: null,
      })),
      novelPromotionData: {
        characters: storyResult.analyzedCharacters.map((item) => ({ name: String(item.name) })),
        locations: storyResult.analyzedLocations.map((item) => ({ name: String(item.name) })),
        props: [],
      },
      promptTemplates: {
        phase1PlanTemplate: '',
        phase2CinematographyTemplate: '',
        phase2ActingTemplate: '',
        phase3DetailTemplate: '',
      },
      runStep: async () => {
        storyboardLlmCalls += 1
        throw new Error('LLM should not be called for deterministic prompt clips')
      },
    })

    expect(storyboardLlmCalls).toBe(0)
    expect(storyboardResult.summary.totalPanelCount).toBe(15)
    expect(storyboardResult.clipPanels[0].finalPanels[0].video_prompt).not.toContain('来源镜头：SH001-SH004')
    expect(storyboardResult.clipPanels[0].finalPanels[0].duration).toBeGreaterThan(1)
    expect(storyboardResult.clipPanels[14].finalPanels[0].video_prompt).not.toContain('来源镜头：SH048-SH050')
  })

  it('compressed docx-style Agent prompt preserves the 15 reference beats and current-beat assets', async () => {
    const compressedPrompt = buildCompressedAgentPrompt(buildMedicalFiftyShotFixture())
    let llmCalls = 0
    const storyResult = await runStoryToScriptOrchestrator({
      content: compressedPrompt,
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '',
        locationPromptTemplate: '',
        propPromptTemplate: '',
        clipPromptTemplate: '',
        screenplayPromptTemplate: '',
      },
      runStep: async () => {
        llmCalls += 1
        throw new Error('LLM should not be called for compressed docx Agent prompt')
      },
    })

    expect(llmCalls).toBe(0)
    expect(storyResult.summary.clipCount).toBe(15)
    expect(storyResult.analyzedCharacters.map((item) => item.name)).toEqual([
      'Ava',
      'Dr. Grayson',
      'Nurse Sarah',
      'Dr. Carter',
    ])
    expectPreciseSegmentPrompt(storyResult.clipList[0].content)
    expect(storyResult.clipList[0].content).not.toContain('来源镜头：SH001-SH004')
    expect(storyResult.clipList[0].content).toContain('Ava')
    expect(storyResult.clipList[0].content).toContain('Dr. Grayson')
    expect(storyResult.clipList[0].content).toContain('英文口型同步')
    expect(storyResult.clipList[0].content).toContain('不要生成中文字幕')
    expect(storyResult.clipList[0].content).toContain('不要生成背景音乐')
    expect(storyResult.clipList[0].content).toMatch(/\nShot 2\n/)
    expect(storyResult.clipList[14].content).not.toContain('来源镜头：SH048-SH050')
    expect(storyResult.clipList[14].content).toContain('Ava')
    expect(storyResult.clipList[14].content).toContain('Dr. Grayson')

    const storyboardResult = await runScriptToStoryboardOrchestrator({
      clips: storyResult.clipList.map((clip) => ({
        id: clip.id,
        content: clip.content,
        characters: JSON.stringify(clip.characters),
        location: clip.location,
        props: JSON.stringify(clip.props),
        screenplay: null,
      })),
      novelPromotionData: {
        characters: storyResult.analyzedCharacters.map((item) => ({ name: String(item.name) })),
        locations: storyResult.analyzedLocations.map((item) => ({ name: String(item.name) })),
        props: storyResult.analyzedProps.map((item) => ({ name: String(item.name) })),
      },
      promptTemplates: {
        phase1PlanTemplate: '',
        phase2CinematographyTemplate: '',
        phase2ActingTemplate: '',
        phase3DetailTemplate: '',
      },
      runStep: async () => {
        throw new Error('LLM should not rewrite compressed docx Agent panels')
      },
    })

    expect(storyboardResult.clipPanels).toHaveLength(15)
    expect(storyboardResult.summary.totalPanelCount).toBe(15)
    const firstPanel = storyboardResult.clipPanels[0].finalPanels[0]
    expectPreciseSegmentPrompt(firstPanel.video_prompt)
    expect(firstPanel.video_prompt).not.toContain('来源镜头：SH001-SH004')
    expect(firstPanel.video_prompt).not.toContain('本 panel 角色行为约束')
    expect(firstPanel.video_prompt).toMatch(/\nShot 2\n/)
    const finalPanelText = storyboardResult.clipPanels[14].finalPanels.map((panel) => panel.video_prompt).join('\n')
    expect(finalPanelText).not.toContain('来源镜头：SH048-SH050')
    expect(finalPanelText).toContain('Shot 1')
  })

  it('Agent story package turns a short fairy-tale prompt into asset-bound video-ready panels', async () => {
    const userInput = '帮我生成一个可爱的动画短片，故事是一天晚上，小兔子在森林里散步，救起掉进小水坑里的萤火虫，萤火虫送给它一盏月亮灯。'
    const analysis: LLMAnalysisResult = {
      videoType: 'generic',
      storyText: '一天晚上，小兔子在森林里散步。忽然，小兔子发现一只萤火虫掉进小水坑里。小兔子伸出树叶把萤火虫救了出来。萤火虫送给小兔子一盏月亮灯。从那以后，小兔子提着月亮灯，为迷路的小动物照亮回家的路。',
      videoRatio: '9:16',
      visualStyle: '可爱童话动画风，柔和月光，温暖治愈',
      projectName: '月亮灯',
      episodeName: '第1集',
      language: 'zh',
      confidence: 1,
    }
    const storyPackageText = serializeAgentStoryPackage(buildAgentStoryPackage({ userInput, analysis }))

    const storyResult = await runStoryToScriptOrchestrator({
      content: storyPackageText,
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '',
        locationPromptTemplate: '',
        propPromptTemplate: '',
        clipPromptTemplate: '',
        screenplayPromptTemplate: '',
      },
      runStep: async () => {
        throw new Error('LLM should not be called for Agent story package fast path')
      },
    })

    expect(storyResult.summary.clipCount).toBeGreaterThanOrEqual(4)
    expect(storyResult.analyzedCharacters.map((item) => item.name)).toContain('小兔子')
    expect(storyResult.analyzedCharacters.map((item) => item.name)).toContain('萤火虫')
    expect(storyResult.analyzedProps.map((item) => item.name)).toEqual(
      expect.arrayContaining(['月亮灯', '树叶', '小水坑']),
    )
    expect(storyResult.analyzedLocations.map((item) => item.name)).toContain('夜晚童话森林')
    expectPreciseSegmentPrompt(storyResult.clipList[0].content)
    expect(storyResult.clipList[0].content).not.toContain('【Agent 视频分镜提示词】')
    expect(storyResult.clipList[0].content).toContain('角色\n小兔子')
    expect(storyResult.clipList[0].content).toMatch(/\nShot 2\n/)
    expect(storyResult.clipList[0].content).toContain('不要把剧情道具改成商品卖点')
    expect(storyResult.clipList.join('\n')).not.toMatch(/少男|少女|young man|young woman/i)
    const rescueClip = storyResult.clipList.find((clip) => clip.props.includes('树叶'))
    expectPreciseSegmentPrompt(rescueClip?.content)
    expect(rescueClip?.content).toContain('小兔子')
    expect(rescueClip?.content).toContain('萤火虫')
    expect(rescueClip?.props).toEqual(expect.arrayContaining(['树叶', '小水坑']))
    const moonLampClip = storyResult.clipList.find((clip) => clip.content.includes('月亮灯'))
    expect(moonLampClip?.content).not.toContain('【关键道具资产保持不变】')
    expect(moonLampClip?.props).toContain('月亮灯')

    const storyboardResult = await runScriptToStoryboardOrchestrator({
      clips: storyResult.clipList.map((clip) => ({
        id: clip.id,
        content: clip.content,
        characters: JSON.stringify(clip.characters),
        location: clip.location,
        props: JSON.stringify(clip.props),
        screenplay: null,
      })),
      novelPromotionData: {
        characters: storyResult.analyzedCharacters.map((item) => ({ name: String(item.name) })),
        locations: storyResult.analyzedLocations.map((item) => ({ name: String(item.name) })),
        props: storyResult.analyzedProps.map((item) => ({ name: String(item.name) })),
      },
      promptTemplates: {
        phase1PlanTemplate: '',
        phase2CinematographyTemplate: '',
        phase2ActingTemplate: '',
        phase3DetailTemplate: '',
      },
      runStep: async () => {
        throw new Error('LLM should not rewrite Agent video-ready prompt clips')
      },
    })

    const firstPanel = storyboardResult.clipPanels[0].finalPanels[0]
    const firstPanelAssetUsage = getPanelAssetUsage({
      characters: firstPanel.characters,
      location: firstPanel.location,
      props: firstPanel.props,
    })
    expect(storyboardResult.summary.totalPanelCount).toBe(storyResult.summary.clipCount)
    expect(storyboardResult.clipPanels[0].finalPanels).toHaveLength(1)
    expectPreciseSegmentPrompt(firstPanel.video_prompt)
    expect(firstPanel.video_prompt).not.toContain('【Agent 视频分镜提示词】')
    expect(firstPanel.video_prompt).not.toContain('本分镜使用资产：角色=小兔子；场景=夜晚童话森林；道具=无独立关键道具，仅使用场景内自然元素。\n本分镜使用资产：')
    expect(firstPanel.video_prompt).toContain('小兔子')
    expect(firstPanel.photographyPlan?.atmosphere).toContain('童话')
    expect(firstPanelAssetUsage.characters.map((item) => item.name)).toContain('小兔子')
    expect(firstPanelAssetUsage.locations).toContain('夜晚童话森林')

    const rescuePanel = storyboardResult.clipPanels
      .flatMap((clip) => clip.finalPanels)
      .find((panel) => (panel.video_prompt || '').includes('树叶') && (panel.video_prompt || '').includes('小水坑'))
    expectPreciseSegmentPrompt(rescuePanel?.video_prompt)
    expect(rescuePanel?.video_prompt).toContain('小兔子')
    expect(rescuePanel?.video_prompt).toContain('萤火虫')
    const rescueAssetUsage = getPanelAssetUsage({
      characters: rescuePanel?.characters,
      location: rescuePanel?.location,
      props: rescuePanel?.props,
    })
    expect(rescueAssetUsage.props).toEqual(expect.arrayContaining(['树叶', '小水坑']))
  })

  it('Agent story package enforces western setting for English/medical prompts', async () => {
    const userInput = 'Create a 9:16 English medical short drama about Ava asking Dr. Grayson for surgery help, no subtitles, no music.'
    const analysis: LLMAnalysisResult = {
      videoType: 'generic',
      storyText: 'Ava waits in a private hospital hallway and asks Dr. Grayson to help arrange surgery. Nurse Sarah questions her. Dr. Grayson protects Ava and leaves emotional tension.',
      videoRatio: '9:16',
      visualStyle: 'realistic western vertical medical drama, English lip sync',
      projectName: 'Hospital Secret',
      episodeName: 'Episode 1',
      language: 'en',
      confidence: 1,
    }
    const storyPackageText = serializeAgentStoryPackage(buildAgentStoryPackage({ userInput, analysis }))
    const storyResult = await runStoryToScriptOrchestrator({
      content: storyPackageText,
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '',
        locationPromptTemplate: '',
        propPromptTemplate: '',
        clipPromptTemplate: '',
        screenplayPromptTemplate: '',
      },
      runStep: async () => {
        throw new Error('LLM should not be called for Agent story package fast path')
      },
    })

    expect(storyResult.analyzedLocations[0].summary).toContain('现代美国私立医院')
    expect(storyResult.clipList[0].content).toContain('英文/欧美故事必须保持国外场景')
    expect(storyResult.clipList[0].content).toContain('英文环境标识')
    expect(storyResult.clipList[0].content).toContain('不要变成亚洲场景')
  })

  it('Agent medical prompt carries role assets, lip-sync constraints, and video-ready timing into storyboard panels', async () => {
    const userInput = [
      '请用 Agent 自动创作模式生成一支 9:16 欧美医疗短剧转绘视频，真实真人短剧质感，英文口型，不要中文字幕，不要背景音乐。',
      '角色资产：',
      'Ava：年轻美国女性，24-27 岁，黑框眼镜，低马尾或微乱浅棕发，奶白色针织开衫和白色内搭；焦急、委屈、脆弱但倔强。',
      'Dr. Grayson：美国男外科医生，30-34 岁，深棕色短发，白大褂，冷静克制。',
      '剧情：Ava 在医院走廊请求 Dr. Grayson 帮她安排手术，Nurse Sarah 质疑她，Dr. Grayson 冷静保护 Ava。',
    ].join('\n')
    const analysis: LLMAnalysisResult = {
      videoType: 'generic',
      storyText: 'Ava waits in a modern American private hospital hallway. Nurse Sarah challenges her request, and Ava, exhausted and tearful, asks Dr. Grayson for help. Dr. Grayson stays controlled, shields Ava from the accusation, and tells her he will handle the surgery arrangement.',
      videoRatio: '9:16',
      visualStyle: '真实真人欧美医疗短剧质感，英文口型',
      projectName: 'Hospital Secret',
      episodeName: 'Episode 1',
      language: 'en',
      confidence: 1,
    }
    const storyPackageText = serializeAgentStoryPackage(buildAgentStoryPackage({ userInput, analysis }))

    const storyResult = await runStoryToScriptOrchestrator({
      content: storyPackageText,
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '',
        locationPromptTemplate: '',
        propPromptTemplate: '',
        clipPromptTemplate: '',
        screenplayPromptTemplate: '',
      },
      runStep: async () => {
        throw new Error('LLM should not be called for Agent story package fast path')
      },
    })

    const allClipText = storyResult.clipList.map((clip) => clip.content).join('\n')
    expect(storyResult.analyzedCharacters.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Ava', 'Dr. Grayson', 'Nurse Sarah']),
    )
    expect(storyResult.analyzedProps.map((item) => item.name)).toContain('手术安排文件')
    expect(allClipText).not.toContain('Ava：年轻美国女性')
    expect(allClipText).not.toContain('Dr. Grayson：美国男外科医生')
    expect(allClipText).toContain('角色行为：')
    expect(allClipText).toContain('英文口型同步')
    expect(allClipText).toContain('不要生成中文字幕')
    expect(allClipText).toContain('不要生成背景音乐')
    expect(allClipText).toMatch(/\nShot 1\n/)
    expect(allClipText).toMatch(/\nduration: \d+\.\d+s/)
    expect(allClipText).toContain('【本分镜负面要求】')
    expect(allClipText).toContain('不要变成亚洲场景')

    const storyboardResult = await runScriptToStoryboardOrchestrator({
      clips: storyResult.clipList.map((clip) => ({
        id: clip.id,
        content: clip.content,
        characters: JSON.stringify(clip.characters),
        location: clip.location,
        props: JSON.stringify(clip.props),
        screenplay: null,
      })),
      novelPromotionData: {
        characters: storyResult.analyzedCharacters.map((item) => ({ name: String(item.name) })),
        locations: storyResult.analyzedLocations.map((item) => ({ name: String(item.name) })),
        props: storyResult.analyzedProps.map((item) => ({ name: String(item.name) })),
      },
      promptTemplates: {
        phase1PlanTemplate: '',
        phase2CinematographyTemplate: '',
        phase2ActingTemplate: '',
        phase3DetailTemplate: '',
      },
      runStep: async () => {
        throw new Error('LLM should not rewrite Agent video-ready prompt clips')
      },
    })

    const firstPanel = storyboardResult.clipPanels[0].finalPanels[0]
    expect(storyboardResult.clipPanels[0].finalPanels).toHaveLength(1)
    const firstPanelAssetUsage = getPanelAssetUsage({
      characters: firstPanel.characters,
      location: firstPanel.location,
      props: firstPanel.props,
    })
    expect(firstPanel.video_prompt).toContain('Ava')
    expectPreciseSegmentPrompt(firstPanel.video_prompt)
    expect(firstPanel.video_prompt).toContain('英文口型同步')
    expect(firstPanel.video_prompt).toContain('不要生成中文字幕')
    expect(firstPanel.location).toContain('现代美国')
    expect(firstPanel.photographyPlan?.lighting).toContain('现代美国医院')
    expect(firstPanel.photographyPlan?.atmosphere).toContain('欧美医疗短剧')
    expect(firstPanelAssetUsage.characters.map((item) => item.name)).toContain('Ava')
    expect(firstPanelAssetUsage.locations).toContain('现代美国私立医院')
    const surgeryPanel = storyboardResult.clipPanels
      .flatMap((clip) => clip.finalPanels)
      .find((panel) => (panel.video_prompt || '').includes('Dr. Grayson') && (panel.video_prompt || '').includes('手术安排文件'))
    expectPreciseSegmentPrompt(surgeryPanel?.video_prompt)
    expect(surgeryPanel?.video_prompt).toContain('角色行为：')
    expect(surgeryPanel?.video_prompt).toMatch(/Dr\. Grayson：/)
  })
})
