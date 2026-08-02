import { describe, expect, it } from 'vitest'
import {
  compileSeedancePromptForSubmission,
  extractSeedanceVideoPromptBody,
  formatSeedancePromptForEditor,
  isSeedanceVideoPromptBody,
  stripSeedancePromptAssetMentions,
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
      '图片1中的苏晚卿走进图片2所示的陆府小院，握紧图片3中的陈阿婆留的银簪。',
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
      '图片3中的苏晚卿离开图片2所示的陆府小院，图片4中的Ava 站在 Avarice 标牌旁。',
    )
  })

  it('converts both official image references and legacy names back to @ mentions for the UI', () => {
    expect(formatSeedancePromptForEditor(
      '图片1中的苏晚卿走进图片2所示的陆府小院，银簪仍在袖中。',
      assets,
    )).toBe('@苏晚卿走进@陆府小院，银簪仍在袖中。')
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

    expect(submitted).toMatch(/^开场状态：\n环境：图片2所示的陆府小院/u)
    expect(submitted).toContain('图片1中的苏晚卿握紧图片3中的陈阿婆留的银簪')
    expect(submitted).not.toContain('◈ 视频提示词')
    expect(submitted).not.toContain('【本分镜负面要求】')
  })
})
