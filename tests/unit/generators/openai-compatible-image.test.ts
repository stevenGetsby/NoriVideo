import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const openAIState = vi.hoisted(() => ({
  generate: vi.fn(),
  edit: vi.fn(),
  toFile: vi.fn(async (
    value: Buffer | Uint8Array,
    name: string,
    options?: { type?: string },
  ) => {
    const bytes = Buffer.from(value)
    return {
      name,
      type: options?.type || 'application/octet-stream',
      size: bytes.length,
      arrayBuffer: async () => bytes,
    }
  }),
}))

const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'openai-compatible:oa-1',
  apiKey: 'oa-key',
  baseUrl: 'https://oa.test/v1',
})))

const getImageBase64CachedMock = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,QQ=='))

vi.mock('openai', () => ({
  default: class OpenAI {
    images = {
      generate: openAIState.generate,
      edit: openAIState.edit,
    }
  },
  toFile: openAIState.toFile,
}))

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

vi.mock('@/lib/image-cache', () => ({
  getImageBase64Cached: getImageBase64CachedMock,
}))

import { OpenAICompatibleImageGenerator } from '@/lib/generators/image/openai-compatible'
import { generateImageViaOpenAICompat } from '@/lib/model-gateway/openai-compat/image'

describe('OpenAICompatibleImageGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({
      id: 'openai-compatible:oa-1',
      apiKey: 'oa-key',
      baseUrl: 'https://oa.test/v1',
    })
  })

  it('uses official images.generate payload parameters', async () => {
    openAIState.generate.mockResolvedValueOnce({
      data: [{ b64_json: 'YmFzZTY0' }],
    })

    const generator = new OpenAICompatibleImageGenerator('gpt-image-1', 'openai-compatible:oa-1')
    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'draw a lighthouse',
      options: {
        size: '1024x1024',
        quality: 'high',
        outputFormat: 'png',
        responseFormat: 'b64_json',
      },
    })

    expect(result.success).toBe(true)
    expect(result.imageBase64).toBe('YmFzZTY0')
    expect(result.imageUrl).toBe('data:image/png;base64,YmFzZTY0')
    expect(openAIState.generate).toHaveBeenCalledWith({
      model: 'gpt-image-1',
      prompt: 'draw a lighthouse',
      response_format: 'b64_json',
      output_format: 'png',
      quality: 'high',
      size: '1024x1024',
    })
  })

  it('uses official images.edit payload when reference images are provided', async () => {
    openAIState.edit.mockResolvedValueOnce({
      data: [{ b64_json: 'ZWRpdA==' }],
    })

    const generator = new OpenAICompatibleImageGenerator('gpt-image-1', 'openai-compatible:oa-1')
    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'edit this image',
      referenceImages: ['data:image/png;base64,QQ=='],
      options: {
        quality: 'medium',
      },
    })

    expect(result.success).toBe(true)
    expect(openAIState.toFile).toHaveBeenCalledTimes(1)

    const call = openAIState.edit.mock.calls[0]
    expect(call).toBeTruthy()
    if (!call) {
      throw new Error('images.edit should be called')
    }
    expect(call[0]).toMatchObject({
      model: 'gpt-image-1',
      prompt: 'edit this image',
      response_format: 'b64_json',
      quality: 'medium',
    })
    expect(Array.isArray((call[0] as { image?: unknown }).image)).toBe(true)
  })

  it('sends an inpaint mask as the dedicated images.edit mask field', async () => {
    const sourcePng = await sharp({
      create: {
        width: 4,
        height: 2,
        channels: 4,
        background: { r: 80, g: 120, b: 160, alpha: 1 },
      },
    }).png().toBuffer()
    const canvasMaskPng = await sharp(Buffer.from([
      255, 255, 255,
      0, 0, 0,
    ]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer()
    openAIState.edit.mockResolvedValueOnce({
      data: [{ b64_json: 'aW5wYWludA==' }],
    })

    const result = await generateImageViaOpenAICompat({
      userId: 'user-1',
      providerId: 'openai-compatible:oa-1',
      modelId: 'gpt-image-1',
      prompt: 'replace only the painted region',
      referenceImages: [`data:image/png;base64,${sourcePng.toString('base64')}`],
      editMode: 'inpaint',
      maskImage: `data:image/png;base64,${canvasMaskPng.toString('base64')}`,
      profile: 'openai-compatible',
    })

    expect(result.success).toBe(true)
    expect(openAIState.edit).toHaveBeenCalledTimes(1)
    expect(openAIState.generate).not.toHaveBeenCalled()
    expect(openAIState.toFile).toHaveBeenCalledTimes(3)

    const payload = openAIState.edit.mock.calls[0]?.[0] as {
      image?: { name?: string; arrayBuffer(): Promise<ArrayBuffer | Uint8Array> }
      mask?: { name?: string; arrayBuffer(): Promise<ArrayBuffer | Uint8Array> }
    } | undefined
    expect(payload?.image).toBeTruthy()
    expect(payload?.mask).toBeTruthy()
    expect(payload?.mask).not.toBe(payload?.image)
    expect(payload?.mask?.name).toBe('mask.png')

    const normalizedMaskData = await payload!.mask!.arrayBuffer()
    const normalizedMask = normalizedMaskData instanceof ArrayBuffer
      ? Buffer.from(normalizedMaskData)
      : Buffer.from(normalizedMaskData)
    const decoded = await sharp(normalizedMask)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(decoded.info).toMatchObject({ width: 4, height: 2, channels: 4 })
    expect(decoded.data[3]).toBe(0)
    expect(decoded.data[((decoded.info.width - 1) * 4) + 3]).toBe(255)
  })

  it('rejects a mask unless the request explicitly declares inpaint mode', async () => {
    await expect(generateImageViaOpenAICompat({
      userId: 'user-1',
      providerId: 'openai-compatible:oa-1',
      modelId: 'gpt-image-1',
      prompt: 'edit this image',
      referenceImages: ['data:image/png;base64,U09VUkNF'],
      maskImage: 'data:image/png;base64,TUFTSw==',
      profile: 'openai-compatible',
    })).rejects.toThrow(/MASK.*INPAINT|INPAINT.*MASK/i)

    expect(openAIState.edit).not.toHaveBeenCalled()
    expect(openAIState.generate).not.toHaveBeenCalled()
  })

  it('rejects an all-black canvas mask with no editable pixels', async () => {
    const sourcePng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 80, g: 120, b: 160, alpha: 1 },
      },
    }).png().toBuffer()
    const emptyCanvasMaskPng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    }).png().toBuffer()

    await expect(generateImageViaOpenAICompat({
      userId: 'user-1',
      providerId: 'openai-compatible:oa-1',
      modelId: 'gpt-image-1',
      prompt: 'replace only the painted region',
      referenceImages: [`data:image/png;base64,${sourcePng.toString('base64')}`],
      editMode: 'inpaint',
      maskImage: `data:image/png;base64,${emptyCanvasMaskPng.toString('base64')}`,
      profile: 'openai-compatible',
    })).rejects.toThrow(/INPAINT_MASK_EMPTY|no editable pixels/i)

    expect(openAIState.edit).not.toHaveBeenCalled()
    expect(openAIState.generate).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'no source image', referenceImages: [] },
    {
      label: 'multiple source images',
      referenceImages: [
        'data:image/png;base64,U09VUkNFMQ==',
        'data:image/png;base64,U09VUkNFMg==',
      ],
    },
  ])('rejects inpaint with $label', async ({ referenceImages }) => {
    await expect(generateImageViaOpenAICompat({
      userId: 'user-1',
      providerId: 'openai-compatible:oa-1',
      modelId: 'gpt-image-1',
      prompt: 'replace only the painted region',
      referenceImages,
      editMode: 'inpaint',
      maskImage: 'data:image/png;base64,TUFTSw==',
      profile: 'openai-compatible',
    })).rejects.toThrow(/INPAINT.*(REFERENCE|SOURCE).*(COUNT|ONE|1)/i)

    expect(openAIState.edit).not.toHaveBeenCalled()
    expect(openAIState.generate).not.toHaveBeenCalled()
  })

  it('fails explicitly on unsupported option values', async () => {
    const generator = new OpenAICompatibleImageGenerator('gpt-image-1', 'openai-compatible:oa-1')
    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'draw',
      options: {
        quality: 'ultra',
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('OPENAI_COMPAT_IMAGE_OPTION_UNSUPPORTED')
  })
})
