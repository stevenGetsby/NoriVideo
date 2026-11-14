import { describe, expect, it } from 'vitest'
import {
  describeContinuation,
  dropTrailingShot,
  formatTimecode,
  mergeStoryboardContinuation,
  normalizeStoryboard,
  parseStoryboard,
  parseTimecode,
  summarizeStoryboard,
  validateStoryboard,
} from '@/lib/video-repaint/storyboard-text'

const shot = (number: number, start: string, end: string, extra: string[] = []): string =>
  [
    `### SH${String(number).padStart(3, '0')} [${start}-${end}]`,
    '镜头：中景，平视，固定镜头，标准 50mm，浅景深，常速，稳定器固定。镜头从桌面起，中段推近，落点停在人物脸上。',
    '画面：堂屋里一张八仙桌，桌上有两本红色房产证。',
    '表情动作：儿子咬牙盯着对面——愤怒。',
    '光影：自然侧逆光。',
    ...extra,
  ].join('\n')

const SCENE_ONE = [
  '## S1 [堂屋客厅 · 日间 · 内] 角色：儿子 / 父亲 / 母亲',
  '造型：儿子=红棕色冲锋衣；父亲=米色开衫；母亲=枣红色毛呢上衣。',
].join('\n')

const FIRST_ROUND = [
  SCENE_ONE,
  shot(1, '00:00.0', '00:02.8', ['儿子 (对口型·愤怒质问)：{爸、妈，两套房加300万……}']),
  shot(2, '00:02.8', '00:05.5', ['儿子 (对口型·激动抗议)：{……你们全划给我一个人……}']),
  shot(3, '00:05.5', '00:07.7', ['复刻补充：本镜尾部约0.3秒与下一镜叠化。']),
].join('\n\n')

describe('timecodes', () => {
  it('parses MM:SS.s, MM:SS, H:MM:SS.fff and plain seconds', () => {
    expect(parseTimecode('00:02.8')).toBeCloseTo(2.8)
    expect(parseTimecode('02:38.0')).toBe(158)
    expect(parseTimecode('1:02:03.5')).toBeCloseTo(3723.5)
    expect(parseTimecode('12.5')).toBe(12.5)
    expect(parseTimecode('00:02,8')).toBeCloseTo(2.8)
  })

  it('rejects malformed values and minutes or seconds of 60 and over', () => {
    expect(parseTimecode('')).toBeNull()
    expect(parseTimecode('ab:cd')).toBeNull()
    expect(parseTimecode('1:2:3:4')).toBeNull()
    expect(parseTimecode('00:75.0')).toBeNull()
    expect(parseTimecode('1:75:00')).toBeNull()
  })

  it('formats as MM:SS.s and keeps counting minutes past an hour', () => {
    expect(formatTimecode(0)).toBe('00:00.0')
    expect(formatTimecode(2.8)).toBe('00:02.8')
    expect(formatTimecode(158)).toBe('02:38.0')
    expect(formatTimecode(3725.04)).toBe('62:05.0')
    expect(formatTimecode(-3)).toBe('00:00.0')
  })
})

describe('parseStoryboard', () => {
  it('reads scenes, 造型 lines, shots, fields and dialogue', () => {
    const document = parseStoryboard(FIRST_ROUND)
    expect(document.scenes).toHaveLength(1)
    const [scene] = document.scenes
    expect(scene).toMatchObject({ number: 1, title: '堂屋客厅 · 日间 · 内', roles: '儿子 / 父亲 / 母亲', implicit: false })
    expect(scene.lines).toEqual(['造型：儿子=红棕色冲锋衣；父亲=米色开衫；母亲=枣红色毛呢上衣。'])
    expect(scene.shots.map((entry) => [entry.number, entry.start, entry.end])).toEqual([
      [1, 0, 2.8],
      [2, 2.8, 5.5],
      [3, 5.5, 7.7],
    ])
    expect(scene.shots[0].lines).toHaveLength(5)
    expect(scene.shots[0].lines[4]).toContain('对口型·愤怒质问')
  })

  it('accepts full-width brackets, dashes, units and heading variants', () => {
    const text = ['### SH001 【0:00-0:02.5】', '画面：甲', '## SH2 [2.5s – 4.0s]', '画面：乙', 'SH003 [00:04.0 至 00:06.0]', '画面：丙'].join('\n')
    const shots = parseStoryboard(text).scenes.flatMap((scene) => scene.shots)
    expect(shots.map((entry) => [entry.number, entry.start, entry.end])).toEqual([
      [1, 0, 2.5],
      [2, 2.5, 4],
      [3, 4, 6],
    ])
  })

  it('creates an implicit scene for shots that come without a scene heading', () => {
    const document = parseStoryboard(shot(24, '01:12.4', '01:15.0'))
    expect(document.scenes).toHaveLength(1)
    expect(document.scenes[0]).toMatchObject({ implicit: true, title: '', roles: '' })
  })

  it('ignores code fences and dividers, and tolerates CRLF', () => {
    const text = ['```markdown', '## S1 [院子 · 夜 · 外] 角色：甲', '---', '### SH001 [00:00.0-00:01.0]', '画面：夜色', '```'].join('\r\n')
    const [scene] = parseStoryboard(text).scenes
    expect(scene.title).toBe('院子 · 夜 · 外')
    expect(scene.shots[0].lines).toEqual(['画面：夜色'])
  })

  it('leaves a shot heading with an unreadable range as text under the previous shot', () => {
    const text = [shot(1, '00:00.0', '00:02.0'), '### SH002 [soon]'].join('\n')
    const shots = parseStoryboard(text).scenes.flatMap((scene) => scene.shots)
    expect(shots).toHaveLength(1)
    expect(shots[0].lines).toContain('### SH002 [soon]')
  })

  it('returns no scenes for prose', () => {
    expect(parseStoryboard('这是一段普通的话。\n没有镜头。').scenes).toEqual([])
  })
})

describe('summarizeStoryboard', () => {
  it('counts scenes, shots, dialogue and roles', () => {
    const summary = summarizeStoryboard(FIRST_ROUND)
    expect(summary).toMatchObject({ sceneCount: 1, shotCount: 3, firstStart: 0, coveredSeconds: 7.7, dialogueCount: 2 })
    expect(summary.roles).toEqual(['儿子', '父亲', '母亲'])
  })

  it('is empty for text without shots', () => {
    expect(summarizeStoryboard('')).toEqual({ sceneCount: 0, shotCount: 0, firstStart: 0, coveredSeconds: 0, dialogueCount: 0, roles: [] })
  })

  it('does not take a field line for a speaker', () => {
    const text = [shot(1, '00:00.0', '00:02.0', ['画面 (特写)：{这不是台词}'])].join('\n')
    expect(summarizeStoryboard(text).dialogueCount).toBe(1)
  })
})

describe('mergeStoryboardContinuation', () => {
  it('appends later shots to the same scene and renumbers them', () => {
    const addition = [
      shot(1, '00:07.7', '00:10.8', ['父亲 (对口型·专断呵斥)：{给你的你就拿着！}']),
      shot(2, '00:10.8', '00:12.7'),
    ].join('\n\n')
    const merged = mergeStoryboardContinuation(FIRST_ROUND, addition)
    expect(merged.addedShots).toBe(2)
    const document = parseStoryboard(merged.text)
    expect(document.scenes).toHaveLength(1)
    expect(document.scenes[0].shots.map((entry) => entry.number)).toEqual([1, 2, 3, 4, 5])
    expect(document.scenes[0].shots[3]).toMatchObject({ start: 7.7, end: 10.8 })
    expect(merged.text).toContain('### SH004 [00:07.7-00:10.8]')
    expect(merged.text.match(/^## S\d/gm)).toHaveLength(1)
  })

  it('drops shots the model repeated and clamps an overlapping first shot', () => {
    const addition = [
      SCENE_ONE,
      shot(1, '00:02.8', '00:05.5'),
      shot(2, '00:05.5', '00:07.7'),
      shot(3, '00:07.0', '00:09.0'),
      shot(4, '00:09.0', '00:11.0'),
    ].join('\n\n')
    const merged = mergeStoryboardContinuation(FIRST_ROUND, addition)
    expect(merged.addedShots).toBe(2)
    const shots = parseStoryboard(merged.text).scenes.flatMap((scene) => scene.shots)
    expect(shots.map((entry) => [entry.number, entry.start, entry.end])).toEqual([
      [1, 0, 2.8],
      [2, 2.8, 5.5],
      [3, 5.5, 7.7],
      [4, 7.7, 9],
      [5, 9, 11],
    ])
  })

  it('merges a repeated scene heading with the same title instead of opening a new scene', () => {
    const addition = [SCENE_ONE.replace('母亲=枣红色毛呢上衣', '姐姐=视频通话').replace('/ 母亲', '/ 母亲 / 姐姐'), shot(1, '00:07.7', '00:09.0')].join('\n\n')
    const merged = mergeStoryboardContinuation(FIRST_ROUND, addition)
    const document = parseStoryboard(merged.text)
    expect(document.scenes).toHaveLength(1)
    expect(document.scenes[0].roles).toBe('儿子 / 父亲 / 母亲 / 姐姐')
  })

  it('opens a new scene when the location changes', () => {
    const addition = ['## S2 [院子 · 夜间 · 外] 角色：儿子', '造型：儿子=同前。', shot(1, '00:07.7', '00:09.0')].join('\n\n')
    const merged = mergeStoryboardContinuation(FIRST_ROUND, addition)
    const document = parseStoryboard(merged.text)
    expect(document.scenes.map((scene) => [scene.number, scene.title, scene.shots.length])).toEqual([
      [1, '堂屋客厅 · 日间 · 内', 3],
      [2, '院子 · 夜间 · 外', 1],
    ])
    expect(document.scenes[1].shots[0].number).toBe(4)
  })

  it('starts from nothing when there is no previous text', () => {
    const merged = mergeStoryboardContinuation('', FIRST_ROUND)
    expect(merged.addedShots).toBe(3)
    expect(merged.text).toBe(FIRST_ROUND)
  })

  it('adds nothing when the reply has no shots after the resume point', () => {
    const merged = mergeStoryboardContinuation(FIRST_ROUND, '已经写完了。')
    expect(merged.addedShots).toBe(0)
    expect(merged.text).toBe(FIRST_ROUND)
  })

  it('round-trips the reference layout byte for byte', () => {
    const text = [FIRST_ROUND, '## S2 [院子 · 夜间 · 外] 角色：儿子\n造型：同前。', shot(4, '00:07.7', '00:09.0')].join('\n\n')
    expect(mergeStoryboardContinuation(text, '').text).toBe(text)
  })
})

describe('dropTrailingShot', () => {
  it('removes the shot that was cut off and keeps the rest', () => {
    const truncated = `${FIRST_ROUND}\n画面：写到一半`
    const result = dropTrailingShot(truncated)
    expect(result.dropped).toBe(true)
    expect(parseStoryboard(result.text).scenes[0].shots.map((entry) => entry.number)).toEqual([1, 2])
  })

  it('removes a scene left without shots', () => {
    const text = [FIRST_ROUND, '## S2 [院子 · 夜间 · 外] 角色：儿子', shot(4, '00:07.7', '00:09.0')].join('\n\n')
    const result = dropTrailingShot(text)
    expect(parseStoryboard(result.text).scenes).toHaveLength(1)
  })

  it('reports nothing to drop for text without shots', () => {
    expect(dropTrailingShot('没有镜头')).toEqual({ text: '', dropped: false })
  })
})

describe('normalizeStoryboard', () => {
  it('closes small gaps and overlaps at the midpoint', () => {
    const text = [SCENE_ONE, shot(1, '00:00.0', '00:02.6'), shot(2, '00:02.9', '00:05.0'), shot(3, '00:05.2', '00:07.0')].join('\n\n')
    const shots = parseStoryboard(normalizeStoryboard(text)).scenes[0].shots
    expect(shots.map((entry) => [entry.start, entry.end])).toEqual([
      [0, 2.8],
      [2.8, 5.1],
      [5.1, 7],
    ])
  })

  it('pulls a boundary onto the detected cut next to it', () => {
    const text = [SCENE_ONE, shot(1, '00:00.0', '00:02.8'), shot(2, '00:02.8', '00:05.5')].join('\n\n')
    const shots = parseStoryboard(normalizeStoryboard(text, { cutHints: [1.1, 3.0, 9] })).scenes[0].shots
    expect(shots.map((entry) => [entry.start, entry.end])).toEqual([
      [0, 3],
      [3, 5.5],
    ])
  })

  it('leaves a boundary alone when no cut is within reach', () => {
    const text = [SCENE_ONE, shot(1, '00:00.0', '00:02.8'), shot(2, '00:02.8', '00:05.5')].join('\n\n')
    const shots = parseStoryboard(normalizeStoryboard(text, { cutHints: [4.0] })).scenes[0].shots
    expect(shots[0].end).toBe(2.8)
  })

  it('does not snap when it would leave a shot shorter than the minimum', () => {
    const text = [SCENE_ONE, shot(1, '00:00.0', '00:00.5'), shot(2, '00:00.5', '00:03.0')].join('\n\n')
    const shots = parseStoryboard(normalizeStoryboard(text, { cutHints: [0.2] })).scenes[0].shots
    expect(shots[0].end).toBe(0.5)
  })

  it('leaves large gaps for validation to report', () => {
    const text = [SCENE_ONE, shot(1, '00:00.0', '00:02.0'), shot(2, '00:05.0', '00:07.0')].join('\n\n')
    const shots = parseStoryboard(normalizeStoryboard(text)).scenes[0].shots
    expect(shots.map((entry) => [entry.start, entry.end])).toEqual([
      [0, 2],
      [5, 7],
    ])
  })

  it('cuts shots that start past the end of the video and clamps the last end', () => {
    const text = [SCENE_ONE, shot(1, '00:00.0', '00:04.0'), shot(2, '00:04.0', '00:09.0'), shot(3, '00:09.0', '00:12.0')].join('\n\n')
    const shots = parseStoryboard(normalizeStoryboard(text, { durationSeconds: 8 })).scenes[0].shots
    expect(shots.map((entry) => [entry.number, entry.start, entry.end])).toEqual([
      [1, 0, 4],
      [2, 4, 8],
    ])
  })

  it('snaps a first start just after zero and a last end just short of the duration', () => {
    const text = [SCENE_ONE, shot(1, '00:00.3', '00:04.0'), shot(2, '00:04.0', '00:07.7')].join('\n\n')
    const shots = parseStoryboard(normalizeStoryboard(text, { durationSeconds: 8 })).scenes[0].shots
    expect(shots[0].start).toBe(0)
    expect(shots[1].end).toBe(8)
  })

  it('renumbers shots and scenes in order and rewrites times to one decimal', () => {
    const text = ['## S4 [甲 · 日 · 内] 角色：a', shot(9, '0:00', '0:02.04'), '## S9 [乙 · 夜 · 外] 角色：b', shot(30, '0:02.04', '0:05')].join('\n\n')
    const normalized = normalizeStoryboard(text)
    expect(normalized).toContain('## S1 [甲 · 日 · 内]')
    expect(normalized).toContain('## S2 [乙 · 夜 · 外]')
    expect(normalized).toContain('### SH001 [00:00.0-00:02.0]')
    expect(normalized).toContain('### SH002 [00:02.0-00:05.0]')
  })

  it('is stable when applied twice', () => {
    const once = normalizeStoryboard(FIRST_ROUND, { cutHints: [2.9, 5.4], durationSeconds: 7.7 })
    expect(normalizeStoryboard(once, { cutHints: [2.9, 5.4], durationSeconds: 7.7 })).toBe(once)
  })
})

describe('validateStoryboard', () => {
  it('passes a clean storyboard without warnings', () => {
    expect(validateStoryboard(FIRST_ROUND, { durationSeconds: 7.7 })).toEqual({ valid: true, errors: [], warnings: [] })
  })

  it('is invalid when no shot can be read', () => {
    const result = validateStoryboard('只有文字')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('没有可识别的镜头')
  })

  it('warns about gaps, overlaps and long shots', () => {
    const text = [SCENE_ONE, shot(1, '00:00.0', '00:02.0'), shot(2, '00:03.5', '00:05.0'), shot(3, '00:04.0', '00:20.0')].join('\n\n')
    const { valid, warnings } = validateStoryboard(text)
    expect(valid).toBe(true)
    expect(warnings.some((warning) => warning.includes('SH002') && warning.includes('空档'))).toBe(true)
    expect(warnings.some((warning) => warning.includes('SH003') && warning.includes('重叠'))).toBe(true)
    expect(warnings.some((warning) => warning.includes('SH003') && warning.includes('长达'))).toBe(true)
  })

  it('warns about missing fields by name', () => {
    const text = [SCENE_ONE, '### SH001 [00:00.0-00:02.0]', '画面：只有画面'].join('\n\n')
    const { warnings } = validateStoryboard(text)
    expect(warnings).toEqual(['SH001 缺少「镜头」「表情动作」「光影」'])
  })

  it('warns when the storyboard stops short of the video or starts late', () => {
    const text = [SCENE_ONE, shot(1, '00:02.0', '00:05.0')].join('\n\n')
    const { warnings } = validateStoryboard(text, { durationSeconds: 60 })
    expect(warnings.some((warning) => warning.includes('才开始'))).toBe(true)
    expect(warnings.some((warning) => warning.includes('只写到 00:05.0') && warning.includes('01:00.0'))).toBe(true)
  })

  it('accepts a storyboard that ends within the tail tolerance', () => {
    const { warnings } = validateStoryboard(FIRST_ROUND, { durationSeconds: 9.5 })
    expect(warnings).toEqual([])
  })

  it('keeps the coverage warning first and caps the list', () => {
    const body = Array.from({ length: 30 }, (_, index) => `### SH${String(index + 1).padStart(3, '0')} [00:0${index % 10}.0-00:0${(index % 10) + 1}.0]\n画面：x`)
    const { warnings } = validateStoryboard([SCENE_ONE, ...body].join('\n\n'), { durationSeconds: 600 })
    expect(warnings[0]).toContain('只写到')
    expect(warnings).toHaveLength(13)
    expect(warnings[12]).toMatch(/另有 \d+ 条提示已省略/)
  })
})

describe('describeContinuation', () => {
  it('reports where to resume, the open scene, the cast and the last two shots', () => {
    const info = describeContinuation(FIRST_ROUND)
    expect(info.shotCount).toBe(3)
    expect(info.resumeAt).toBe(7.7)
    expect(info.lastScene).toMatchObject({ number: 1, title: '堂屋客厅 · 日间 · 内', roles: '儿子 / 父亲 / 母亲' })
    expect(info.lastScene?.lines[0]).toContain('造型：')
    expect(info.roles).toEqual(['儿子', '父亲', '母亲'])
    expect(info.tail).toContain('### SH002 [00:02.8-00:05.5]')
    expect(info.tail).toContain('### SH003 [00:05.5-00:07.7]')
    expect(info.tail).not.toContain('### SH001')
  })

  it('starts from zero for an empty storyboard', () => {
    expect(describeContinuation('')).toEqual({ shotCount: 0, resumeAt: 0, lastScene: null, roles: [], tail: '' })
  })
})
