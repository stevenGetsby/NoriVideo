import { describe, expect, it } from 'vitest'
import {
  buildCompressedAgentPrompt,
  buildPreciseBeatVideoPrompt,
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

  it('matches the reference medical case as 15 precise segment prompt blocks', () => {
    const blocks = buildVideoPromptBlocks(buildMedicalFiftyShotFixture())
    expect(blocks).toHaveLength(15)
    expect(blocks[0].segmentId).toBe('S01-SEG01')
    expect(blocks[0].text).toMatch(/^S01-SEG01\n/)
    expect(blocks[0].text).toContain('◎ 参考资产')
    expect(blocks[0].text).toContain('◎ 输出参数')
    expect(blocks[0].text).toContain('◈ 一致性控制')
    expect(blocks[0].text).toContain('◈ 视频提示词')
    expect(blocks[0].text).toContain('开场状态：')
    expect(blocks[0].text).toContain('Shot 1')
    expect(blocks[0].text).toContain('duration:')
    expect(blocks[0].text).toContain('镜头：')
    expect(blocks[0].text).toContain('画面：')
    expect(blocks[0].text).toContain('光影：')
    expect(blocks[0].text).not.toContain('来源镜头：SH001-SH004')
    expect(blocks[14].text).not.toContain('来源镜头：SH048-SH050')
  })

  it('builds precise segment prompt text without global asset boilerplate', () => {
    const text = buildShortDramaVideoPromptText(buildMedicalFiftyShotFixture())
    expect(text).toMatch(/^S01-SEG01\n/)
    expect(text).toContain('◎ 参考资产')
    expect(text).toContain('◈ 视频提示词')
    expect(text).toContain('Shot 1')
    expect(text).not.toContain('【短剧角色资产保持不变】')
    expect(text).not.toContain('Ava：年轻美国女性')
    expect(text).not.toContain('Dr. Grayson：美国男外科医生')
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

  it('builds video-ready brief prompts with precise segment and internal shots', () => {
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

    expect(lines[0]).toBe('S01-SEG01')
    expect(lines[1]).toBe('现代美国私立医院')
    expect(prompt).toContain('◎ 参考资产')
    expect(prompt).toContain('角色\nAva\nDr. Grayson\nNurse Sarah')
    expect(prompt).toContain('物品\n手术安排文件')
    expect(prompt).toContain('◈ 一致性控制')
    expect(prompt).toContain('◈ 视频提示词')
    expect(prompt).toContain('开场状态：')
    expect(prompt).toContain('站位关系：')
    expect(prompt).toContain('Shot 1')
    expect(prompt).toMatch(/\nShot 2\n/)
    expect(prompt).toMatch(/\nduration: \d+\.\d+s/)
    expect(prompt).toContain('镜头：')
    expect(prompt).toContain('画面：')
    expect(prompt).toContain('光影：')
    expect(prompt).not.toContain('【短剧角色资产保持不变】')
    expect(prompt).not.toContain('来源镜头：')
    expect(prompt).toContain('不要生成中文字幕')
    expect(prompt).toContain('不要自动生成大段字幕')
  })

  it('turns a beat into structured cinematic internal shots instead of generic templates', () => {
    const prompt = buildPreciseBeatVideoPrompt({
      segmentId: 'S01-SEG01',
      location: '张秃子家破旧柴房',
      beat: '开场钩子：第一集开场：苏晚卿在破旧柴房中从药效和惊恐中醒来，意识到自己被卖给张秃子。',
      durationSeconds: 15,
      characters: [{ name: '苏晚卿', appearance: '孤女逃亡时期' }],
      props: [{ name: '陈阿婆留的银簪', state: '藏在发髻中，完好' }],
    })

    expect(prompt).toContain('Shot 5')
    expect(prompt).toContain('大特写')
    expect(prompt).toContain('瞳孔骤然收缩')
    expect(prompt).toContain('2700K')
    expect(prompt).toContain('6500K')
    expect(prompt).toContain('key:fill')
    expect(prompt).toContain('◈ 画风描述')
    expect(prompt).not.toContain('完成本段核心动作')
    expect(prompt).not.toContain('口型同步，说：苏晚卿在破旧柴房中从药效和惊恐中醒来')
  })

  it('does not treat script camera labels as lip-sync dialogue', () => {
    const narrationPrompt = buildPreciseBeatVideoPrompt({
      segmentId: 'S01-SEG01',
      location: '张秃子家破旧柴房',
      beat: '开场钩子：镜头特写：我猛地从混沌中惊醒，脑袋昏沉、浑身酸软，眼底满是惊恐与屈辱。',
      durationSeconds: 10,
      characters: [{ name: '苏晚卿', appearance: '孤女逃亡时期' }],
      props: [{ name: '陈阿婆留的银簪', state: '藏在发髻中，完好' }],
    })
    expect(narrationPrompt).not.toContain('口型同步，说：我猛地从混沌中惊醒')

    const dialoguePrompt = buildPreciseBeatVideoPrompt({
      segmentId: 'S02-SEG03',
      location: '城郊破旧土地庙',
      beat: '情绪承载：我（低声呢喃）：阿婆，我不能死，我还要回去找你……',
      durationSeconds: 8,
      characters: [{ name: '苏晚卿', appearance: '孤女逃亡时期' }],
      props: [{ name: '陈阿婆留的银簪', state: '攥在手心' }],
    })
    expect(dialoguePrompt).toContain('口型同步，说：阿婆，我不能死，我还要回去找你')

    const conflictPrompt = buildPreciseBeatVideoPrompt({
      segmentId: 'S01-SEG04',
      location: '张秃子家破旧柴房',
      beat: [
        '制造冲突：张秃子（粗哑狞笑，抓我手腕）：小美人，你娘把你卖给我还下了药，从今往后你就是我的人！',
        '我（缩手蜷身，声音发颤却藏狠劲）：放开我！我娘卖我不算数，就算死，我也不伺候你这个恶魔！',
      ].join('\n'),
      durationSeconds: 12,
      characters: [{ name: '苏晚卿', appearance: '孤女逃亡时期' }, { name: '张秃子' }],
      props: [{ name: '陈阿婆留的银簪', state: '藏在发髻中，完好' }],
    })
    expect(conflictPrompt).toContain('口型同步，说：小美人，你娘把你卖给我还下了药，从今往后你就是我的人！')
    expect(conflictPrompt).toContain('口型同步，说：放开我！')
    expect(conflictPrompt).not.toContain('口型同步，说：小美人，你娘把你卖给我还下了药，从今往后你就是我的人！ 我（缩手蜷身')
  })
})
