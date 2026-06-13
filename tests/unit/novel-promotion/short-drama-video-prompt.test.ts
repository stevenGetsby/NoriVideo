import { describe, expect, it } from 'vitest'
import {
  buildCompressedAgentPrompt,
  buildShortDramaBriefVideoPrompt,
  buildShortDramaVideoPromptText,
  buildVideoPromptBlocks,
  parseShortDramaBrief,
  parseShotSheetText,
} from '@/lib/novel-promotion/short-drama-video-prompt'

function buildShot(number: number, start: number, end: number, overrides: Partial<Record<string, string>> = {}) {
  const code = String(number).padStart(3, '0')
  const mmss = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  const defaults: Record<string, string> = {
    '景别': number % 5 === 0 ? '全景' : '中景',
    '机位': '平视',
    '运镜': number % 7 === 0 ? '轻推' : '固定',
    '画面': `Ava 与 Dr. Grayson 在医院走廊推进剧情 ${number}`,
    '角色': 'Ava / Dr. Grayson',
    '动作': 'Ava 抬头，Dr. Grayson 保持冷静',
    '微表情': '眼神紧张',
    '对白/字幕': number % 3 === 0 ? '(对口型) Ava: Test line.' : '（空）',
    '光影': '冷白顶灯',
    '声音/剪辑': '（空）',
  }
  return [
    `### SH${code} [${mmss(start)}-${mmss(end)}]`,
    ...Object.entries({ ...defaults, ...overrides }).map(([key, value]) => `${key}：${value}`),
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
    const duration = i === 18 ? 3 : 2
    parts.push(buildShot(i, seconds, seconds + duration, i === 18
      ? {
        '景别': '特写',
        '机位': '微俯拍',
        '画面': '戴着沾血无菌手套的手拿着手术刀进行精细切割。',
        '角色': 'Dr. Grayson',
      }
      : {}))
    seconds += duration
  }
  return parts.join('\n')
}

describe('short-drama-video-prompt', () => {
  it('parses SH shot-sheet text into structured shots', () => {
    const shots = parseShotSheetText(buildMedicalFiftyShotFixture())
    expect(shots).toHaveLength(50)
    expect(shots[0]).toMatchObject({
      code: 'SH001',
      scene: expect.objectContaining({ sceneId: 'S1' }),
    })
    expect(shots[49]).toMatchObject({
      code: 'SH050',
      scene: expect.objectContaining({ sceneId: 'S4' }),
    })
  })

  it('matches the reference medical case as 15 video prompt blocks', () => {
    const blocks = buildVideoPromptBlocks(buildMedicalFiftyShotFixture())
    expect(blocks).toHaveLength(15)
    expect(blocks[0].text).toMatch(/^场景：/)
    expect(blocks[0].text).toContain('剧情片段：')
    expect(blocks[0].text).toContain('本分镜使用资产：')
    expect(blocks[0].text).not.toContain('来源镜头：SH001-SH004')
    expect(blocks[14].text).not.toContain('来源镜头：SH048-SH050')
  })

  it('builds canonical panel prompt text without global asset boilerplate', () => {
    const text = buildShortDramaVideoPromptText(buildMedicalFiftyShotFixture())
    expect(text).toMatch(/^场景：/)
    expect(text).not.toContain('【短剧角色资产保持不变】')
    expect(text).not.toContain('Ava：年轻美国女性')
    expect(text).not.toContain('Dr. Grayson：美国男外科医生')
    expect(text).toContain('英文口型同步')
    expect(text).toContain('【本分镜负面要求】')
    expect(text).not.toContain('【全局负面要求】')
    expect(text).not.toContain('沾血')
  })

  it('builds compressed Agent prompt from the same shot-sheet', () => {
    const prompt = buildCompressedAgentPrompt(buildMedicalFiftyShotFixture())
    expect(prompt).toContain('故事压缩节拍')
    expect(prompt).toContain('1. SH001-SH004')
    expect(prompt).toContain('15. SH048-SH050')
    expect(prompt).toContain('先抽取并锁定全局资产')
  })

  it('builds video-ready brief prompts with scene, staging, camera language, and timed actions first', () => {
    const brief = parseShortDramaBrief([
      '请用 Agent 自动创作模式生成一支 9:16 欧美医疗短剧转绘视频，真实真人短剧质感，英文口型，不要中文字幕，不要背景音乐。',
      '角色资产：',
      'Ava：年轻美国女性，24-27 岁，黑框眼镜，低马尾，奶白色针织开衫；焦急、委屈、脆弱但倔强。',
      'Dr. Grayson：美国男外科医生，30-34 岁，白色医生大褂，冷静克制。',
      'Nurse Sarah：美国注册护士，浅蓝色护士服，医用口罩，眼神严厉。',
      '剧情：Ava 在医院走廊请求 Dr. Grayson 帮外婆安排手术。Ava: Please help my grandma. Nurse Sarah: She missed the surgery schedule and now she is making a scene. Dr. Grayson 冷静看着 Ava。',
    ].join('\n'))

    expect(brief).not.toBeNull()
    const prompt = buildShortDramaBriefVideoPrompt({
      brief: brief!,
      beat: 'Ava 在医院走廊请求 Dr. Grayson 帮外婆安排手术。Ava: Please help my grandma. Nurse Sarah: She missed the surgery schedule and now she is making a scene. Dr. Grayson 冷静看着 Ava。',
      beatIndex: 1,
      totalBeats: 1,
    })
    const lines = prompt.split('\n')

    expect(lines[0]).toMatch(/^场景：现代美国私立医院/)
    expect(lines[1]).toContain('剧情片段：Ava 在医院走廊请求 Dr. Grayson')
    expect(lines[2]).toContain('执行要求：严格执行本 video_prompt')
    expect(lines[3]).toContain('本分镜使用资产：角色=Ava、Dr. Grayson、Nurse Sarah')
    expect(lines[4]).toContain('角色行为拆分：Ava')
    expect(lines[5]).toContain('人物站位：')
    expect(lines[6]).toContain('镜头语言：')
    expect(prompt).toMatch(/\n0-\d+s：中景，平视，固定镜头。/)
    expect(prompt).toMatch(/\n\d+-\d+s：近景或越肩/)
    expect(prompt).not.toContain('2-3s：近景或越肩')
    expect(prompt).not.toContain('【短剧角色资产保持不变】')
    expect(prompt).not.toContain('来源镜头：')
    expect(prompt).toContain('不要生成中文字幕')
    expect(prompt).toContain('不要自动生成大段字幕')
  })
})
