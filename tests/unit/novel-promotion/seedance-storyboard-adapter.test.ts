import { describe, expect, it } from 'vitest'
import {
  buildSeedanceStoryboardGenerationInput,
  buildSeedanceStoryboardVideoTaskRequest,
} from '@/lib/novel-promotion/seedance-storyboard-adapter'

describe('seedance storyboard adapter', () => {
  it('maps a cinematic segment prompt and reference assets to Seedance 2.0 content task fields', () => {
    const request = buildSeedanceStoryboardVideoTaskRequest({
      segment: {
        videoPrompt: 'S01-SEG01\n◈ 视频提示词\nShot 1：大特写，苏晚卿惊醒。',
        durationSeconds: 3,
      },
      referenceAssets: [
        { kind: 'character', name: '苏晚卿', imageUrl: 'asset://char-su', role: 'reference_image' },
        { kind: 'character', name: '苏晚卿', imageUrl: 'asset://char-su', role: 'reference_image' },
        { kind: 'location', name: '张秃子家破旧柴房', imageUrl: 'https://cdn.example/woodshed.png', role: 'reference_image' },
      ],
      options: {
        model: 'ark::doubao-seedance-2-0-260128',
        ratio: '9:16',
        resolution: '720p',
        generateAudio: false,
        watermark: false,
      },
    })

    expect(request).toEqual({
      model: 'doubao-seedance-2-0-260128',
      content: [
        { type: 'text', text: 'S01-SEG01\n◈ 视频提示词\nShot 1：大特写，苏晚卿惊醒。' },
        { type: 'image_url', image_url: { url: 'asset://char-su' }, role: 'reference_image' },
        { type: 'image_url', image_url: { url: 'https://cdn.example/woodshed.png' }, role: 'reference_image' },
      ],
      resolution: '720p',
      ratio: '9:16',
      duration: 4,
      generate_audio: false,
      watermark: false,
    })
  })

  it('builds ArkVideoGenerator params from the same structured Seedance request', () => {
    const input = buildSeedanceStoryboardGenerationInput({
      segment: {
        videoPrompt: 'Shot 1：85mm 大特写，银簪在油灯下闪光。',
        durationSeconds: 12,
      },
      referenceAssets: [
        { kind: 'prop', name: '陈阿婆留的银簪', imageUrl: 'https://cdn.example/hairpin.png', role: 'reference_image' },
      ],
      options: {
        model: 'doubao-seedance-2-0-fast-260128',
        ratio: '16:9',
        resolution: '480p',
        seed: 42,
        cameraFixed: false,
      },
    })

    expect(input).toEqual({
      prompt: 'Shot 1：85mm 大特写，银簪在油灯下闪光。',
      imageUrl: '',
      options: {
        modelId: 'doubao-seedance-2-0-fast-260128',
        referenceImages: ['https://cdn.example/hairpin.png'],
        resolution: '480p',
        duration: 12,
        aspectRatio: '16:9',
        generateAudio: true,
        seed: 42,
        cameraFixed: false,
      },
    })
  })
})
