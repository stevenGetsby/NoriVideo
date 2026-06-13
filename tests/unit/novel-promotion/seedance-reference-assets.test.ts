import { describe, expect, it } from 'vitest'
import {
  buildPanelSeedanceReferenceAssets,
  buildSeedanceReferenceImageContentItems,
} from '@/lib/novel-promotion/seedance-reference-assets'

describe('seedance reference asset helpers', () => {
  it('builds character and scene reference images from panel fields and video_prompt asset line', () => {
    const assets = buildPanelSeedanceReferenceAssets({
      panel: {
        characters: JSON.stringify(['Ava', 'Dr. Grayson']),
        location: '现代美国私立医院走廊',
        props: JSON.stringify(['手术安排文件']),
        videoPrompt: [
          '本分镜使用资产：角色=Ava、Dr. Grayson；场景=现代美国私立医院走廊，白色墙面配浅蓝色横向导视线；道具=手术安排文件。',
          '0-2s：中景，平视过肩，固定镜头。Ava 站在 Dr. Grayson 面前。',
        ].join('\n'),
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
})
