import { describe, expect, it } from 'vitest'
import { matchCanvasPromptAssets } from '@/features/canvas/components/canvas-auto-match'
import { frameosAssetAliasesFromMetadata } from '@/lib/frameos/material-category'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'

function material(id: string, title: string, input: Partial<FrameosMaterialItem> = {}): FrameosMaterialItem {
  return {
    id, projectId: 'project-1', projectName: '我的项目', ownerName: null,
    title, type: 'image', source: 'upload', status: 'ready', isFavorited: false,
    resultUrl: `/${id}.webp`, storageKey: null, url: `/${id}.webp`,
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...input,
  }
}

const character = material('char-1', '沈娇', { metadata: { assetCategory: 'character', aliases: ['娇娇', '沈小姐'] } })
const location = material('loc-1', '雨夜街巷', { metadata: { assetCategory: 'location' } })
const prop = material('prop-1', '油纸伞', { metadata: { assetCategory: 'prop' } })

describe('one-click prompt asset matching', () => {
  it('selects assets by official name and alias, once per asset, in stable category order', () => {
    const hits = matchCanvasPromptAssets(
      '油纸伞斜靠在雨夜街巷的墙边，娇娇撑着伞走来，沈小姐回头看了一眼。',
      [prop, location, character],
      ['image', 'video', 'audio'],
    )
    expect(hits.map((hit) => hit.material.id)).toEqual(['char-1', 'loc-1', 'prop-1'])
    expect(hits[0].matchedTerm).toBe('娇娇')
  })

  it('never matches names inside quoted dialogue', () => {
    const hits = matchCanvasPromptAssets('沈娇说“娇娇，把油纸伞拿来”，随后撑开油纸伞。', [character, prop], ['image'])
    expect(hits.map((hit) => hit.material.id)).toEqual(['char-1', 'prop-1'])
    expect(matchCanvasPromptAssets('“沈娇和油纸伞”', [character, prop], ['image'])).toEqual([])
  })

  it('absorbs a shorter name inside a longer matched name', () => {
    const short = material('short', '审计角色甲', { metadata: { assetCategory: 'character' } })
    const long = material('long', '审计角色甲长', { metadata: { assetCategory: 'character' } })
    const hits = matchCanvasPromptAssets('审计角色甲长走进画面', [short, long], ['image'])
    expect(hits.map((hit) => hit.material.id)).toEqual(['long'])
  })

  it('keeps a short name that also appears independently outside the longer name', () => {
    const short = material('short', '沈娇', { metadata: { assetCategory: 'character' } })
    const long = material('long', '沈娇姐姐', { metadata: { assetCategory: 'character' } })
    const hits = matchCanvasPromptAssets('沈娇姐姐回头，沈娇走进门', [short, long], ['image'])
    expect(hits.map((hit) => hit.material.id).sort()).toEqual(['long', 'short'])
    expect(hits.find((hit) => hit.material.id === 'short')?.matchedTerm).toBe('沈娇')
  })

  it('prefers the official name over an alias of another asset at the same span', () => {
    const official = material('official', '沈娇', { metadata: { assetCategory: 'character' } })
    const aliased = material('aliased', '沈家大小姐', { metadata: { assetCategory: 'character', aliases: ['沈娇'] } })
    expect(matchCanvasPromptAssets('沈娇走进门', [aliased, official], ['image']).map((hit) => hit.material.id)).toEqual(['official'])
    expect(matchCanvasPromptAssets('沈娇走进门', [official, aliased], ['image']).map((hit) => hit.material.id)).toEqual(['official'])
  })

  it('skips a span when two different official names tie, instead of letting order decide', () => {
    const first = material('first', '沈娇', { metadata: { assetCategory: 'character' } })
    const second = material('second', '沈娇', { metadata: { assetCategory: 'location' } })
    expect(matchCanvasPromptAssets('沈娇走进门', [first, second], ['image'])).toEqual([])
  })

  it('excludes single-character and pure-digit names from bare matching', () => {
    const single = material('single', '甲', { metadata: { assetCategory: 'character' } })
    const digits = material('digits', '59', { metadata: { assetCategory: 'character' } })
    expect(matchCanvasPromptAssets('审计场景甲里出现 59 号标记', [single, digits], ['image'])).toEqual([])
  })

  it('excludes full-width digit names from bare matching', () => {
    const fullWidth = material('full-width', '１２', { metadata: { assetCategory: 'character' } })
    expect(matchCanvasPromptAssets('编号１２的角色', [fullWidth], ['image'])).toEqual([])
  })

  it('does not match a name whose span intersects a dialogue quote range', () => {
    // “娇娇” is a contiguous span starting at the opening quote; the whole
    // span lies inside the dialogue range and must stay literal.
    const asset = material('cross', '娇娇', { metadata: { assetCategory: 'character' } })
    expect(matchCanvasPromptAssets('“娇娇”走进门', [asset], ['image'])).toEqual([])
    // The same name outside the quotes still matches.
    expect(matchCanvasPromptAssets('“娇娇”之外，娇娇走进门', [asset], ['image']).map((hit) => hit.material.id)).toEqual(['cross'])
  })

  it('requires ASCII identifier boundaries', () => {
    const ava = material('ava', 'Ava')
    expect(matchCanvasPromptAssets('Avarice walks in', [ava], ['image'])).toEqual([])
    expect(matchCanvasPromptAssets('Ava walks in', [ava], ['image']).map((hit) => hit.material.id)).toEqual(['ava'])
  })

  it('respects allowed media types and ready status', () => {
    const voice = material('voice-1', '沈娇音色', { type: 'audio', url: '/voice.wav', metadata: { assetCategory: 'character' } })
    const processing = material('pending', '雨夜街巷草稿', { status: 'processing' })
    const prompt = '环境雨声响起，雨夜街巷草稿'
    const ambient = material('ambient', '环境雨声', { type: 'audio', url: '/rain.wav' })
    expect(matchCanvasPromptAssets(prompt, [character, ambient, processing], ['image'])).toEqual([])
    expect(matchCanvasPromptAssets(prompt, [character, ambient, processing], ['image', 'audio']).map((hit) => hit.material.id)).toEqual(['ambient'])
    expect(matchCanvasPromptAssets('沈娇音色响起', [voice], ['image'])).toEqual([])
  })

  it('returns nothing for empty or whitespace prompts and unmatched text', () => {
    expect(matchCanvasPromptAssets('', [character], ['image'])).toEqual([])
    expect(matchCanvasPromptAssets('   ', [character], ['image'])).toEqual([])
    expect(matchCanvasPromptAssets('一段没有任何资产的描述', [character], ['image'])).toEqual([])
  })

  it('is idempotent: repeated names still select the asset once', () => {
    const hits = matchCanvasPromptAssets('沈娇看着沈娇，娇娇就是沈娇', [character], ['image'])
    expect(hits).toHaveLength(1)
    expect(hits[0].matchedTerm).toBe('沈娇')
  })
})

describe('asset alias metadata parsing', () => {
  it('accepts arrays and separated strings, trims and deduplicates', () => {
    expect(frameosAssetAliasesFromMetadata({ aliases: ['娇娇', ' 沈小姐 ', '娇娇'] })).toEqual(['娇娇', '沈小姐'])
    expect(frameosAssetAliasesFromMetadata({ aliases: '娇娇,沈小姐、阿娇；小娇' })).toEqual(['娇娇', '沈小姐', '阿娇', '小娇'])
    expect(frameosAssetAliasesFromMetadata({ aliases: 42 })).toEqual([])
    expect(frameosAssetAliasesFromMetadata(null)).toEqual([])
  })
})
