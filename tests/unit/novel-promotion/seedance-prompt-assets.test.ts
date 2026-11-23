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
  it('compiles @ asset mentions to bound 图N（名） form in content order', () => {
    const prompt = '@苏晚卿走进@陆府小院，握紧@陈阿婆留的银簪。'

    expect(compileSeedancePromptForSubmission(prompt, assets)).toBe(
      '图1（@图片1）是角色苏晚卿，后文出现 图1（苏晚卿） 时必须始终指代该资产，图2（@图片2）是场景陆府小院，后文出现 图2（陆府小院） 时必须始终指代该资产，图3（@图片3）是道具陈阿婆留的银簪，后文出现 图3（陈阿婆留的银簪） 时必须始终指代该资产\n图1（苏晚卿）走进图2（陆府小院），握紧图3（陈阿婆留的银簪）。',
    )
  })

  it('uses the real content-array index after de-duplicating same-name assets', () => {
    const prompt = '@苏晚卿离开@陆府小院，@Ava 站在 Avarice 标牌旁。'
    const orderedAssets: SeedancePromptAsset[] = [
      { kind: 'location', name: '陆府' },
      { kind: 'location', name: '陆府小院' },
      { kind: 'character', name: '苏晚卿' },
      { kind: 'character', name: '苏晚卿' },
      { kind: 'character', name: 'Ava' },
    ]

    expect(compileSeedancePromptForSubmission(prompt, orderedAssets)).toBe(
      '图1（@图片1）是场景陆府，后文出现 图1（陆府） 时必须始终指代该资产，图2（@图片2）是场景陆府小院，后文出现 图2（陆府小院） 时必须始终指代该资产，图3（@图片3）是角色苏晚卿，后文出现 图3（苏晚卿） 时必须始终指代该资产，图4（@图片4）是角色Ava，后文出现 图4（Ava） 时必须始终指代该资产\n图3（苏晚卿）离开图2（陆府小院），图4（Ava） 站在 Avarice 标牌旁。',
    )
  })

  it('converts bound forms, official image references and legacy names back to @ mentions for the UI', () => {
    expect(formatSeedancePromptForEditor(
      '图片1中的苏晚卿走进图片2所示的陆府小院，银簪仍在袖中。',
      assets,
    )).toBe('@苏晚卿走进@陆府小院，银簪仍在袖中。')
    expect(formatSeedancePromptForEditor(
      '图1（苏晚卿）走进图2（陆府小院）。',
      assets,
    )).toBe('@苏晚卿走进@陆府小院。')
    expect(formatSeedancePromptForEditor(
      '@图片1（苏晚卿）走进@图片2（陆府小院）。',
      assets,
    )).toBe('@苏晚卿走进@陆府小院。')
  })

  it('declares bound voices in their submitted audio order', () => {
    const submitted = compileSeedancePromptForSubmission('@苏晚卿看向@陆府小院。', assets, ['苏晚卿'])

    expect(submitted).toContain('音频1是角色苏晚卿的声音\n图1（苏晚卿）看向图2（陆府小院）。')
  })

  it('removes UI markers for text/first-frame modes without reference assets', () => {
    expect(stripSeedancePromptAssetMentions('@苏晚卿在@陆府小院醒来。', assets))
      .toBe('苏晚卿在陆府小院醒来。')
    expect(stripSeedancePromptAssetMentions('无角色@的镜头')).toBe('无角色的镜头')
  })

  it('strips segment metadata, negative requirements and output parameters before generation', () => {
    const legacyPrompt = [
      'S01-SEG01',
      '◎ 参考资产',
      '◈ 视频提示词',
      '开场状态：',
      '环境：陆府小院，夜。',
      '苏晚卿：半躺在角落。',
      '',
      'Shot 1',
      'duration: 3.0s',
      '镜头：85mm 大特写，缓慢推近。',
      '画面：苏晚卿惊醒。',
      '光影：高反差侧逆光。',
      '【本分镜负面要求】 不要字幕。',
      '◈ 画风描述',
      '电影感。',
      '◎ 输出参数',
      '720p',
    ].join('\n')

    expect(extractSeedanceVideoPromptBody(legacyPrompt)).toBe([
      '开场状态：',
      '环境：陆府小院，夜。',
      '苏晚卿：半躺在角落。',
      '',
      'Shot 1',
      'duration: 3.0s',
      '镜头：85mm 大特写，缓慢推近。',
      '画面：苏晚卿惊醒。',
      '光影：高反差侧逆光。',
    ].join('\n'))
    expect(isSeedanceVideoPromptBody(legacyPrompt)).toBe(true)
  })

  it('keeps clean canonical bodies and only canonicalizes excess Shot spacing', () => {
    const body = '开场状态：\n环境：陆府小院。\n\n\nShot 1\nduration: 3s\n镜头：推近。\n画面：苏晚卿。\n光影：侧逆光。'
    expect(extractSeedanceVideoPromptBody(body)).toBe('开场状态：\n环境：陆府小院。\n\nShot 1\nduration: 3s\n镜头：推近。\n画面：苏晚卿。\n光影：侧逆光。')
    expect(isSeedanceVideoPromptBody(body)).toBe(true)
  })

  it('does not mistake incomplete prose for a canonical body', () => {
    expect(isSeedanceVideoPromptBody('开场状态：陆府小院，苏晚卿醒来。')).toBe(false)
    expect(extractSeedanceVideoPromptBody('苏晚卿在陆府小院醒来。')).toBe('苏晚卿在陆府小院醒来。')
  })

  it('removes fenced markdown and trailing negative requirements', () => {
    const body = extractSeedanceVideoPromptBody('```text\n开场状态：\n环境：陆府小院。\n\n【本分镜负面要求】\n不要字幕。\n```')
    expect(body).toBe('开场状态：\n环境：陆府小院。')
    expect(body).not.toContain('【本分镜负面要求】')
  })

  it('submits only the body and compiles its @ assets to bound image references', () => {
    const legacyPrompt = [
      'S01-SEG01',
      '◈ 视频提示词',
      '开场状态：',
      '环境：@陆府小院，夜。',
      '@苏晚卿：半躺在角落。',
      '',
      'Shot 1',
      'duration: 3.0s',
      '镜头：85mm 大特写，缓慢推近。',
      '画面：@苏晚卿握紧@陈阿婆留的银簪。',
      '光影：高反差侧逆光。',
      '【本分镜负面要求】 不要字幕。',
    ].join('\n')

    const submitted = compileSeedancePromptForSubmission(
      extractSeedanceVideoPromptBody(legacyPrompt),
      assets,
    )

    expect(submitted).toMatch(/环境：图2（陆府小院），夜。/u)
    expect(submitted).toContain('图1（苏晚卿）握紧图3（陈阿婆留的银簪）')
    expect(submitted).not.toContain('◈ 视频提示词')
    expect(submitted).not.toContain('【本分镜负面要求】')
  })

  it('keeps asset names inside quoted dialogue unbound in submission mode', () => {
    const submitted = compileSeedancePromptForSubmission('苏晚卿说“陆府小院很不错”。', assets)
    expect(submitted).toContain('图1（苏晚卿）说“陆府小院很不错”。')
    expect(submitted).not.toContain('说“图2（陆府小院）')
  })
})

describe('Seedance @mention compilation (production regressions)', () => {
  const reference = (
    type: SeedanceMentionReference['type'],
    index: number,
    names: string[],
    fallbackNames: string[] = [],
    kind?: SeedanceMentionReference['kind'],
  ): SeedanceMentionReference => ({ type, index, names, fallbackNames, kind })

  it('binds bare asset names outside dialogue but never inside quotes (user example)', () => {
    const result = compileSeedanceMentionPrompt(
      '@外军军官在@荒漠沙地种棉花，@外军军官说“@荒漠沙地很不错”',
      [
        reference('image', 1, ['外军军官'], [], 'character'),
        reference('image', 2, ['荒漠沙地'], [], 'location'),
      ],
      { mediaReferences: true },
    )
    expect(result.prompt).toBe(
      '图1（@图片1）是角色外军军官，后文出现 图1（外军军官） 时必须始终指代该资产，图2（@图片2）是场景荒漠沙地，后文出现 图2（荒漠沙地） 时必须始终指代该资产\n图1（外军军官）在图2（荒漠沙地）种棉花，图1（外军军官）说“@荒漠沙地很不错”',
    )
    expect(result.unresolved).toEqual([])
  })

  it('binds bare names without any @ markers and shields 「」 and English-quote dialogue', () => {
    const result = compileSeedanceMentionPrompt(
      '外军军官在荒漠沙地种棉花，外军军官说「荒漠沙地很不错」，又用英文引号说"荒漠沙地真好"',
      [
        reference('image', 1, ['外军军官'], [], 'character'),
        reference('image', 2, ['荒漠沙地'], [], 'location'),
      ],
      { mediaReferences: true },
    )
    expect(result.prompt).toContain('图1（外军军官）在图2（荒漠沙地）种棉花')
    expect(result.prompt).toContain('说「荒漠沙地很不错」')
    expect(result.prompt).toContain('说"荒漠沙地真好"')
    expect(result.prompt).not.toContain('「图2')
    expect(result.prompt).not.toContain('"图2')
  })

  it('never lets a bare title claim the tail of a longer, unknown @mention', () => {
    const result = compileSeedanceMentionPrompt(
      '@女主_萧令仪 抬头看向萧令仪的倒影',
      [reference('image', 1, [], ['萧令仪'])],
      { mediaReferences: true },
    )
    expect(result.prompt).toBe(
      '图1（@图片1）是资产萧令仪，后文出现 图1（萧令仪） 时必须始终指代该资产\n@女主_萧令仪 抬头看向图1（萧令仪）的倒影',
    )
    expect(result.unresolved.map((item) => item.text)).toEqual(['女主_萧令仪'])
  })

  it('keeps same-title image materials distinct by their editor mention names', () => {
    const result = compileSeedanceMentionPrompt(
      '@剪贴板素材-1·图片2 站在@剪贴板素材-1·图片1 身后',
      [
        reference('image', 1, ['剪贴板素材-1·图片1'], ['剪贴板素材-1']),
        reference('image', 2, ['剪贴板素材-1·图片2'], ['剪贴板素材-1']),
      ],
      { mediaReferences: true },
    )
    expect(result.prompt).toContain('图2（剪贴板素材-1·图片2） 站在图1（剪贴板素材-1·图片1） 身后')
    expect(result.unresolved).toEqual([])
  })

  it('keeps video/audio ordered references and strips image markers without references', () => {
    const references = [
      reference('image', 1, ['蒙面人']),
      reference('audio', 1, ['蒙面人音色(1)']),
      reference('video', 1, ['打斗参考']),
    ]
    expect(compileSeedanceMentionPrompt('@蒙面人 模仿@打斗参考，用@蒙面人音色(1)说话', references, { mediaReferences: true }).prompt)
      .toContain('图1（蒙面人） 模仿视频1，用音频1说话')
    expect(compileSeedanceMentionPrompt('@蒙面人 用@蒙面人音色(1)说话', references, { mediaReferences: false }).prompt)
      .toBe('蒙面人 用蒙面人音色(1)说话')
  })

  it('prefers the exact editor mention when materials share a title', () => {
    const result = compileSeedanceMentionPrompt(
      '@林夏 回头',
      [reference('image', 1, [], ['林夏']), reference('image', 2, ['林夏'], ['林夏 定妆照'])],
      { mediaReferences: true },
    )
    expect(result.prompt).toContain('图2（林夏） 回头')
  })

  it('names the asset itself in declarations, dropping the editor ·图片/·音频 suffix', () => {
    const result = compileSeedanceMentionPrompt(
      '@米娅·图片 看向远方，@米娅·音频 低声说话',
      [
        reference('image', 1, ['米娅·图片'], ['米娅']),
        reference('audio', 1, ['米娅·音频'], ['米娅']),
      ],
      { mediaReferences: true },
    )
    expect(result.prompt).toBe(
      '图1（@图片1）是资产米娅，后文出现 图1（米娅） 时必须始终指代该资产，音频1是米娅的声音\n图1（米娅·图片） 看向远方，音频1 低声说话',
    )
    expect(result.unresolved).toEqual([])
  })

  it('never doubles the @ marker in image declarations', () => {
    const result = compileSeedanceMentionPrompt(
      '@米娅·图片 回头',
      [reference('image', 1, ['米娅·图片'], ['米娅'])],
      { mediaReferences: true },
    )
    expect(result.prompt).toContain('图1（@图片1）是资产米娅')
    expect(result.prompt).not.toContain('@@')
  })

  it('keeps numbered editor labels intact because the suffix is their only identity', () => {
    const result = compileSeedanceMentionPrompt(
      '@剪贴板素材-1·图片2 站在@剪贴板素材-1·图片1 身后',
      [
        reference('image', 1, ['剪贴板素材-1·图片1'], ['剪贴板素材-1']),
        reference('image', 2, ['剪贴板素材-1·图片2'], ['剪贴板素材-1']),
      ],
      { mediaReferences: true },
    )
    expect(result.prompt).toContain('是资产剪贴板素材-1·图片1')
    expect(result.prompt).toContain('是资产剪贴板素材-1·图片2')
  })

  it('strips the ·音频 suffix from bound-voice declarations in submission mode', () => {
    const submitted = compileSeedancePromptForSubmission('@苏晚卿看向@陆府小院。', assets, ['苏晚卿·音频'])
    expect(submitted).toContain('音频1是角色苏晚卿的声音')
    expect(submitted).not.toContain('苏晚卿·音频的声音')
  })

  it('leaves pure-digit and single-character names out of bare binding but keeps explicit @', () => {
    const references = [reference('image', 1, ['1']), reference('image', 2, ['剑'])]
    const result = compileSeedanceMentionPrompt('时长2秒，9:16，镜头1，@1 出鞘，剑光一闪', references, { mediaReferences: true })
    expect(result.prompt).toContain('时长2秒，9:16，镜头1')
    expect(result.prompt).toContain('图1（1） 出鞘')
    expect(result.prompt).toContain('剑光一闪')
    expect(result.prompt).not.toContain('图2（剑）光')
  })

  it('does not rebind names already inside a written binding', () => {
    const result = compileSeedanceMentionPrompt(
      '图1（外军军官）站在荒漠沙地上',
      [reference('image', 1, ['外军军官']), reference('image', 2, ['荒漠沙地'])],
      { mediaReferences: true },
    )
    expect(result.prompt).toContain('图1（外军军官）站在图2（荒漠沙地）上')
    expect(result.prompt).not.toContain('图1（图1')
  })

  it('shields dialogue when a curly closing quote is missing (rest of paragraph stays literal)', () => {
    const result = compileSeedanceMentionPrompt(
      '外军军官说“荒漠沙地很不错\n荒漠沙地的全景镜头\n\n荒漠沙地全貌',
      [reference('image', 1, ['外军军官']), reference('image', 2, ['荒漠沙地'])],
      { mediaReferences: true },
    )
    expect(result.prompt).toContain('图1（外军军官）说“荒漠沙地很不错')
    expect(result.prompt).toContain('\n荒漠沙地的全景镜头')
    expect(result.prompt).toContain('图2（荒漠沙地）全貌')
  })

  it('shields only the current line when a straight closing quote is missing', () => {
    const result = compileSeedanceMentionPrompt(
      '外军军官说"荒漠沙地很不错\n荒漠沙地的全景镜头',
      [reference('image', 1, ['外军军官']), reference('image', 2, ['荒漠沙地'])],
      { mediaReferences: true },
    )
    expect(result.prompt).toContain('说"荒漠沙地很不错')
    expect(result.prompt).toContain('图2（荒漠沙地）的全景镜头')
  })
})
