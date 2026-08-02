import { describe, expect, it } from 'vitest'
import {
  buildSeedanceStoryboardGenerationInput,
  buildSeedanceStoryboardVideoTaskRequest,
} from '@/lib/novel-promotion/seedance-storyboard-adapter'

describe('seedance storyboard adapter', () => {
  it('maps a cinematic segment prompt and reference assets to Seedance 2.0 content task fields', () => {
    const request = buildSeedanceStoryboardVideoTaskRequest({
      segment: {
        videoPrompt: [
          'S01-SEG01',
          '张秃子家破旧柴房',
          '◎ 参考资产',
          '◈ 视频提示词',
          '开场状态：',
          '环境：@张秃子家破旧柴房，夜，暴雨。',
          '@苏晚卿：半躺在角落。',
          '灯光：暖黄油灯与冷青闪电。',
          '',
          'Shot 1',
          'duration: 3.0s',
          '镜头：85mm 大特写，缓慢推近。',
          '画面：@苏晚卿惊醒。',
          '光影：高反差侧逆光。',
          '<暴雨声>',
          '【本分镜负面要求】 不要字幕。',
        ].join('\n'),
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
        {
          type: 'text',
          text: [
            '开场状态：',
            '环境：图片2所示的张秃子家破旧柴房，夜，暴雨。',
            '图片1中的苏晚卿：半躺在角落。',
            '灯光：暖黄油灯与冷青闪电。',
            '',
            'Shot 1',
            'duration: 3.0s',
            '镜头：85mm 大特写，缓慢推近。',
            '画面：图片1中的苏晚卿惊醒。',
            '光影：高反差侧逆光。',
            '<暴雨声>',
          ].join('\n'),
        },
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
        videoPrompt: 'Shot 1：85mm 大特写，@陈阿婆留的银簪在油灯下闪光。',
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
      prompt: 'Shot 1：85mm 大特写，图片1中的陈阿婆留的银簪在油灯下闪光。',
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
