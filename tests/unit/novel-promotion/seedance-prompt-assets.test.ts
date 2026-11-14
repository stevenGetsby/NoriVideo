import { describe, expect, it } from 'vitest'
import {
  compileSeedanceMentionPrompt,
  compileSeedancePromptForSubmission,
  extractSeedanceVideoPromptBody,
  formatSeedancePromptForEditor,
  isSeedanceVideoPromptBody,
  stripSeedancePromptAssetMentions,
  type SeedanceMentionReference,
  type SeedancePromptAsset,
} from '@/lib/novel-promotion/seedance-prompt-assets'

const assets: SeedancePromptAsset[] = [
  { kind: 'character', name: '苏晚卿' },
  { kind: 'location', name: '陆府小院' },
  { kind: 'prop', name: '陈阿婆留的银簪' },
]

describe('Seedance asset prompt conventions', () => {
  it('compiles @ asset mentions to official image numbers in content order', () => {
    const prompt = '@苏晚卿走进@陆府小院，握紧@陈阿婆留的银簪。'

    expect(compileSeedancePromptForSubmission(prompt, assets)).toBe(
      '图1（@图片1）是角色苏晚卿，后文出现 @图片1 时必须始终指代该资产，图2（@图片2）是场景陆府小院，后文出现 @图片2 时必须始终指代该资产，图3（@图片3）是道具陈阿婆留的银簪，后文出现 @图片3 时必须始终指代该资产\n@图片1（苏晚卿）走进@图片2（陆府小院），握紧@图片3（陈阿婆留的银簪）。',
    )
  })

  it('compiles legacy plain asset names and protects overlapping names', () => {
    const prompt = '苏晚卿离开陆府小院，Ava 站在 Avarice 标牌旁。'
    const orderedAssets: SeedancePromptAsset[] = [
      { kind: 'location', name: '陆府' },
      { kind: 'location', name: '陆府小院' },
      { kind: 'character', name: '苏晚卿' },
      { kind: 'character', name: 'Ava' },
    ]

    expect(compileSeedancePromptForSubmission(prompt, orderedAssets)).toBe(
      '图1（@图片1）是场景陆府，后文出现 @图片1 时必须始终指代该资产，图2（@图片2）是场景陆府小院，后文出现 @图片2 时必须始终指代该资产，图3（@图片3）是角色苏晚卿，后文出现 @图片3 时必须始终指代该资产，图4（@图片4）是角色Ava，后文出现 @图片4 时必须始终指代该资产\n@图片3（苏晚卿）离开@图片2（陆府小院），@图片4（Ava） 站在 Avarice 标牌旁。',
    )
  })

  it('converts both official image references and legacy names back to @ mentions for the UI', () => {
    expect(formatSeedancePromptForEditor(
      '图片1中的苏晚卿走进图片2所示的陆府小院，银簪仍在袖中。',
      assets,
    )).toBe('@苏晚卿走进@陆府小院，银簪仍在袖中。')
  })

  it('declares bound voices in their submitted audio order', () => {
    const submitted = compileSeedancePromptForSubmission('@苏晚卿看向@陆府小院。', assets, ['苏晚卿'])

    expect(submitted).toContain('音频1是角色苏晚卿的声音\n@图片1（苏晚卿）看向@图片2（陆府小院）。')
  })

  it('removes UI markers for text/first-frame modes without reference assets', () => {
    expect(stripSeedancePromptAssetMentions('@苏晚卿回头看向@陆府小院。', assets)).toBe(
      '苏晚卿回头看向陆府小院。',
    )
  })

  it('extracts the canonical prompt body from legacy Segment packaging', () => {
    const legacyPrompt = [
      'S01-SEG01',
      '陆府小院',
      '8s',
      '',
      '◎ 参考资产',
      '角色',
      '苏晚卿',
      '',
      '◈ 视频提示词',
      '120 字',
      '开场状态：',
      '环境：',
      '陆府小院，夜，暴雨。',
      '站位关系：',
      '苏晚卿：位于门边。',
      '灯光：冷青月光。',
      '',
      'Shot 1',
      'duration: 3.0s',
      '镜头：近景，缓慢推近。',
      '画面：',
      '苏晚卿握紧银簪。',
      '光影：冷青主光。',
      '<暴雨声>',
      '',
      '【本分镜负面要求】 不要字幕。',
      '',
      '◈ 画风描述',
      '电影质感。',
    ].join('\n')

    const body = extractSeedanceVideoPromptBody(legacyPrompt)

    expect(body).toBe([
      '开场状态：',
      '环境：',
      '陆府小院，夜，暴雨。',
      '站位关系：',
      '苏晚卿：位于门边。',
      '灯光：冷青月光。',
      '',
      'Shot 1',
      'duration: 3.0s',
      '镜头：近景，缓慢推近。',
      '画面：',
      '苏晚卿握紧银簪。',
      '光影：冷青主光。',
      '<暴雨声>',
    ].join('\n'))
    expect(isSeedanceVideoPromptBody(body)).toBe(true)
    expect(body).not.toContain('S01-SEG01')
    expect(body).not.toContain('◎ 参考资产')
    expect(body).not.toContain('【本分镜负面要求】')
  })

  it('submits only the body and compiles its @ assets to official image references', () => {
    const legacyPrompt = [
      'S01-SEG01',
      '◈ 视频提示词',
      '开场状态：',
      '环境：@陆府小院，夜。',
      '@苏晚卿：位于门边。',
      '灯光：冷青月光。',
      '',
      'Shot 1',
      'duration: 3.0s',
      '镜头：近景。',
      '画面：@苏晚卿握紧@陈阿婆留的银簪。',
      '光影：冷青主光。',
      '<暴雨声>',
      '【本分镜负面要求】 不要字幕。',
    ].join('\n')

    const submitted = compileSeedancePromptForSubmission(
      extractSeedanceVideoPromptBody(legacyPrompt),
      assets,
    )

    expect(submitted).toMatch(/环境：@图片2（陆府小院），夜。/u)
    expect(submitted).toContain('@图片1（苏晚卿）握紧@图片3（陈阿婆留的银簪）')
    expect(submitted).not.toContain('◈ 视频提示词')
    expect(submitted).not.toContain('【本分镜负面要求】')
  })
})

describe('Seedance @mention compilation (production regressions)', () => {
  const reference = (
    type: SeedanceMentionReference['type'],
    index: number,
    names: string[],
    fallbackNames: string[] = [],
  ): SeedanceMentionReference => ({ type, index, names, fallbackNames })

  it('never lets a bare title claim the tail of a longer, unknown @mention', () => {
    const result = compileSeedanceMentionPrompt(
      '@女主_萧令仪 抬头看向萧令仪的倒影',
      [reference('image', 1, [], ['萧令仪'])],
      { mediaReferences: true },
    )
    expect(result.prompt).toBe('@女主_萧令仪 抬头看向萧令仪的倒影')
    expect(result.unresolved.map((item) => item.text)).toEqual(['女主_萧令仪'])
  })

  it('compiles editor-generated duplicate names to the submitted image position', () => {
    const result = compileSeedanceMentionPrompt(
      '@剪贴板素材-1·图片2 站在@剪贴板素材-1·图片1 身后',
      [
        reference('image', 1, ['剪贴板素材-1·图片1'], ['剪贴板素材-1']),
        reference('image', 2, ['剪贴板素材-1·图片2'], ['剪贴板素材-1']),
      ],
      { mediaReferences: true },
    )
    expect(result.prompt).toContain('@图片2（剪贴板素材-1·图片2） 站在@图片1（剪贴板素材-1·图片1） 身后')
    expect(result.unresolved).toEqual([])
  })

  it('compiles audio and video mentions only when those media are actually submitted', () => {
    const references = [
      reference('image', 1, ['蒙面人']),
      reference('audio', 1, ['蒙面人音色(1)']),
      reference('video', 1, ['打斗参考']),
    ]
    expect(compileSeedanceMentionPrompt('@蒙面人 模仿@打斗参考，用@蒙面人音色(1)说话', references, { mediaReferences: true }).prompt)
      .toContain('@图片1（蒙面人） 模仿视频1，用音频1说话')
    expect(compileSeedanceMentionPrompt('@蒙面人 用@蒙面人音色(1)说话', references, { mediaReferences: false }).prompt)
      .toBe('蒙面人 用蒙面人音色(1)说话')
  })

  it('prefers the exact editor name over another reference whose title is the same', () => {
    const result = compileSeedanceMentionPrompt(
      '@林夏 回头',
      [reference('image', 1, [], ['林夏']), reference('image', 2, ['林夏'], ['林夏 定妆照'])],
      { mediaReferences: true },
    )
    expect(result.prompt).toContain('@图片2（林夏） 回头')
  })
})
