import { describe, expect, it } from 'vitest'
import {
  firstLastFrameInputSchema,
  imageToVideoInputSchema,
  readMediaDurationSeconds,
  resolveCanvasGenerationInputSchema,
  validateCanvasReferenceMedia,
  validateCanvasRequiredFields,
  validateVideoReferenceMediaCombination,
} from '@/lib/canvas/generation-input-schema'

describe('canvas generation input schema', () => {
  it('uses provider capability input limits instead of a second UI-only limit table', () => {
    const schema = resolveCanvasGenerationInputSchema('video', {
      video: {
        inputSchema: {
          image: { min: 1, max: 4 },
          video: { min: 0, max: 2 },
          audio: { min: 0, max: 2, maxTotalDurationSeconds: 12 },
          requiredFields: ['prompt'],
        },
      },
    })
    expect(schema).toEqual({
      image: { min: 1, max: 4 },
      video: { min: 0, max: 2 },
      audio: { min: 0, max: 2, maxTotalDurationSeconds: 12 },
      requiredFields: ['prompt'],
    })
  })

  it('makes first/last frame exactly two images and rejects every non-image reference', () => {
    const schema = firstLastFrameInputSchema()
    expect(validateCanvasReferenceMedia(schema, [
      { id: 'first', title: '首帧', type: 'image' },
      { id: 'last', title: '尾帧', type: 'image' },
    ])).toEqual([])
    expect(validateCanvasReferenceMedia(schema, [
      { id: 'first', title: '首帧', type: 'image' },
      { id: 'video', title: '错误视频', type: 'video' },
    ])).toEqual(expect.arrayContaining([
      '参考图片至少需要 2 个。',
      '当前模型不支持参考视频。',
    ]))
  })

  it('makes image-to-video require images and reject video or audio references', () => {
    const schema = imageToVideoInputSchema(4)
    expect(validateCanvasReferenceMedia(schema, [])).toContain('参考图片至少需要 1 个。')
    expect(validateCanvasReferenceMedia(schema, [
      { id: 'image', title: '参考图', type: 'image' },
    ])).toEqual([])
    expect(validateCanvasReferenceMedia(schema, [
      { id: 'image', title: '参考图', type: 'image' },
      { id: 'video', title: '错误视频', type: 'video' },
    ])).toContain('当前模型不支持参考视频。')
  })

  it('validates audio counts, known duration, total duration and required fields', () => {
    const schema = resolveCanvasGenerationInputSchema('video')
    expect(validateCanvasReferenceMedia(schema, [
      { id: 'a', title: '音频 A', type: 'audio', durationSeconds: 8 },
      { id: 'b', title: '音频 B', type: 'audio', durationSeconds: 8 },
    ])).toContain('参考音频总时长最多 15 秒，当前约 16 秒。')
    expect(validateCanvasReferenceMedia(schema, [
      { id: 'a', title: '旧音频', type: 'audio', durationSeconds: null },
    ])).toContain('无法读取部分参考音频的时长，请重新上传后再试。')
    expect(validateCanvasRequiredFields(resolveCanvasGenerationInputSchema('audio'), {
      prompt: '旁白',
      voice: '',
    })).toEqual(['嗓音为必填项。'])
  })

  it('requires a visual reference whenever reference audio is used for video', () => {
    const audio = { id: 'voice', title: '角色音色', type: 'audio' as const, durationSeconds: 6 }

    expect(validateVideoReferenceMediaCombination([audio])).toEqual([
      '参考音频不能单独提交，请至少同时选择 1 张参考图片或 1 个参考视频。',
    ])
    expect(validateVideoReferenceMediaCombination([
      audio,
      { type: 'image' },
    ])).toEqual([])
    expect(validateVideoReferenceMediaCombination([
      audio,
      { type: 'video' },
    ])).toEqual([])
  })

  it('reads duration metadata produced by upload and generated-audio paths', () => {
    expect(readMediaDurationSeconds({ durationSeconds: 4.25 })).toBe(4.25)
    expect(readMediaDurationSeconds({ durationMs: 2500 })).toBe(2.5)
    expect(readMediaDurationSeconds({})).toBeNull()
  })
})
