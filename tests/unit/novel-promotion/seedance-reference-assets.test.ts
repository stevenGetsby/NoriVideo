import { describe, expect, it } from 'vitest'
import {
  buildPanelSeedanceReferenceAssets,
  buildSeedanceReferenceImageContentItems,
  buildStoryboardSegmentSeedanceReferenceAssets,
  mergePanelSeedanceReferenceAssets,
  readPanelSeedanceReferenceAssetsFromActingNotes,
  replacePanelSeedanceReferenceAssetForCharacter,
} from '@/lib/novel-promotion/seedance-reference-assets'

describe('seedance reference asset helpers', () => {
  it('builds character and scene reference images from structured panel fields', () => {
    const assets = buildPanelSeedanceReferenceAssets({
      panel: {
        characters: JSON.stringify(['Ava', 'Dr. Grayson']),
        location: '现代美国私立医院走廊',
        props: JSON.stringify(['手术安排文件']),
      },
      characterAssets: [
        { name: 'Ava', imageUrl: 'https://cdn.example/ava.png' },
        { name: 'Dr. Grayson', imageUrls: JSON.stringify(['https://cdn.example/grayson.png']) },
        { name: 'Nurse Sarah', imageUrl: 'https://cdn.example/sarah.png' },
      ],
      locationAssets: [
        { name: '现代美国私立医院走廊', assetKind: 'location', imageUrl: 'https://cdn.example/hospital-corridor.png' },
        { name: '手术安排文件', assetKind: 'prop', imageUrl: 'https://cdn.example/surgery-file.png' },
      ],
    })

    expect(assets).toEqual([
      { kind: 'character', name: 'Ava', imageUrl: 'https://cdn.example/ava.png', role: 'reference_image' },
      { kind: 'character', name: 'Dr. Grayson', imageUrl: 'https://cdn.example/grayson.png', role: 'reference_image' },
      { kind: 'location', name: '现代美国私立医院走廊', imageUrl: 'https://cdn.example/hospital-corridor.png', role: 'reference_image' },
      { kind: 'prop', name: '手术安排文件', imageUrl: 'https://cdn.example/surgery-file.png', role: 'reference_image' },
    ])
    expect(buildSeedanceReferenceImageContentItems(assets)).toEqual([
      { type: 'image_url', image_url: { url: 'https://cdn.example/ava.png' }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: 'https://cdn.example/grayson.png' }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: 'https://cdn.example/hospital-corridor.png' }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: 'https://cdn.example/surgery-file.png' }, role: 'reference_image' },
    ])
  })

  it('skips missing images and unrelated assets', () => {
    const assets = buildPanelSeedanceReferenceAssets({
      panel: {
        characters: JSON.stringify(['Ava', 'Nurse Sarah']),
        location: 'ICU外走廊',
      },
      characterAssets: [
        { name: 'Ava', imageUrl: null },
        { name: 'Nurse Sarah', appearances: [{ imageUrl: 'https://cdn.example/sarah.png' }] },
        { name: 'Dr. Carter', imageUrl: 'https://cdn.example/carter.png' },
      ],
      locationAssets: [
        { name: '高科技手术室', assetKind: 'location', imageUrl: 'https://cdn.example/or.png' },
      ],
    })

    expect(assets).toEqual([
      { kind: 'character', name: 'Nurse Sarah', imageUrl: 'https://cdn.example/sarah.png', role: 'reference_image' },
    ])
  })

  it('uses the exact storyboard appearance instead of the first character image', () => {
    const assets = buildPanelSeedanceReferenceAssets({
      panel: {
        characters: JSON.stringify([{
          name: '苏晚卿',
          appearance: '雨夜逃亡',
          appearanceId: 'appearance-rain',
        }]),
      },
      characterAssets: [{
        name: '苏晚卿',
        appearances: [
          { id: 'appearance-main', changeReason: '初始形象', imageUrl: 'https://cdn.example/main.png' },
          { id: 'appearance-rain', changeReason: '雨夜逃亡', imageUrl: 'https://cdn.example/rain.png' },
        ],
      }],
    })

    expect(assets).toEqual([{
      kind: 'character',
      name: '苏晚卿',
      imageUrl: 'https://cdn.example/rain.png',
      role: 'reference_image',
      appearance: '雨夜逃亡',
      appearanceId: 'appearance-rain',
    }])
  })

  it('builds reference images from new episode workflow segment assets', () => {
    const assets = buildStoryboardSegmentSeedanceReferenceAssets({
      segment: {
        characters: [{ name: '苏晚卿' }, { name: '张秃子' }],
        location: '张秃子家破旧柴房',
        props: [{ name: '陈阿婆留的银簪' }],
      },
      characterAssets: [
        { name: '苏晚卿', imageUrl: 'asset://char-su' },
        { name: '张秃子', imageUrl: 'https://cdn.example/zhang.png' },
      ],
      locationAssets: [
        { name: '张秃子家破旧柴房', assetKind: 'location', imageUrl: 'https://cdn.example/woodshed.png' },
        { name: '陈阿婆留的银簪', assetKind: 'prop', imageUrl: 'https://cdn.example/hairpin.png' },
      ],
    })

    expect(assets).toEqual([
      { kind: 'character', name: '苏晚卿', imageUrl: 'asset://char-su', role: 'reference_image' },
      { kind: 'character', name: '张秃子', imageUrl: 'https://cdn.example/zhang.png', role: 'reference_image' },
      { kind: 'location', name: '张秃子家破旧柴房', imageUrl: 'https://cdn.example/woodshed.png', role: 'reference_image' },
      { kind: 'prop', name: '陈阿婆留的银簪', imageUrl: 'https://cdn.example/hairpin.png', role: 'reference_image' },
    ])
  })

  it('maps a legacy character ref to the episode-specific variant', () => {
    const metadata = (label: string, coverageEpisodes: number[]) => JSON.stringify({
      _frameosAppearanceMetadata: { label, coverage_episodes: coverageEpisodes },
    })
    const assets = buildPanelSeedanceReferenceAssets({
      panel: { characters: JSON.stringify([{ name: '苏晚卿', appearance: '陆府低位姨太时期' }]) },
      episodeNumber: 6,
      characterAssets: [{
        name: '苏晚卿',
        appearances: [
          {
            id: 'appearance-main',
            appearanceIndex: 0,
            changeReason: '陆府低位姨太时期',
            descriptions: metadata('陆府低位姨太时期', [5, 6, 7, 8]),
            imageUrl: 'https://cdn.example/main.png',
          },
          {
            id: 'appearance-confined',
            appearanceIndex: 1,
            changeReason: '陆府受辱禁足状态',
            descriptions: metadata('陆府受辱禁足状态', [5, 6, 7, 8]),
            imageUrl: 'https://cdn.example/confined.png',
          },
        ],
      }],
    })

    expect(assets).toEqual([{
      kind: 'character',
      name: '苏晚卿',
      imageUrl: 'https://cdn.example/confined.png',
      role: 'reference_image',
      appearance: '陆府受辱禁足状态',
      appearanceId: 'appearance-confined',
    }])
  })

  it('only replaces the exact appearance asset uri', () => {
    const actingNotes = JSON.stringify({
      _seedanceReferenceAssets: [
        { kind: 'character', name: '苏晚卿', appearanceId: 'main', imageUrl: 'asset://main-old', role: 'reference_image' },
        { kind: 'character', name: '苏晚卿', appearanceId: 'rain', imageUrl: 'asset://rain-old', role: 'reference_image' },
        { kind: 'character', name: '苏晚卿', imageUrl: 'legacy-main.png', role: 'reference_image' },
      ],
    })
    const updated = replacePanelSeedanceReferenceAssetForCharacter(actingNotes, {
      characterName: '苏晚卿',
      appearanceId: 'rain',
      assetUri: 'asset://rain-new',
    })
    const refs = readPanelSeedanceReferenceAssetsFromActingNotes(updated)

    expect(refs.map((item) => item.imageUrl)).toEqual([
      'asset://main-old',
      'asset://rain-new',
      'legacy-main.png',
    ])
  })

  it('keeps explicitly added material references when contextual bindings refresh', () => {
    expect(mergePanelSeedanceReferenceAssets([
      { kind: 'character', name: '苏晚卿', imageUrl: 'variant.png', role: 'reference_image', appearanceId: 'variant' },
    ], [
      { kind: 'character', name: '苏晚卿', imageUrl: 'stale-main.png', role: 'reference_image' },
      { kind: 'prop', name: '用户补充参考', imageUrl: 'manual.png', role: 'reference_image', materialId: 'material-1' },
    ])).toEqual([
      { kind: 'character', name: '苏晚卿', imageUrl: 'variant.png', role: 'reference_image', appearanceId: 'variant' },
      { kind: 'prop', name: '用户补充参考', imageUrl: 'manual.png', role: 'reference_image', materialId: 'material-1' },
    ])
  })
})
