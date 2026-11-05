import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderConfigMock = vi.hoisted(() =>
  vi.fn(async () => ({ apiKey: 'openlux-secret-key-for-test', baseUrl: 'https://api.openlux.ai/v1' })),
)
const normalizeReferencesMock = vi.hoisted(() =>
  vi.fn(async (images: string[]) => images),
)
const normalizeMaskMock = vi.hoisted(() =>
  vi.fn(async (image: string) => image),
)

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

vi.mock('@/lib/media/outbound-image', () => ({
  normalizeReferenceImagesForGeneration: normalizeReferencesMock,
  normalizeToPublicImageUrlForGeneration: normalizeMaskMock,
}))

import {
  buildOpenLuxImageFields,
  buildOpenLuxUrl,
  generateOpenLuxImage,
} from '@/lib/providers/openlux'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function imageResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'content-type': 'image/png' },
  })
}

describe('OpenLux image adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({ apiKey: 'openlux-secret-key-for-test', baseUrl: 'https://api.openlux.ai/v1' })
    normalizeReferencesMock.mockImplementation(async (images: string[]) => images)
    normalizeMaskMock.mockImplementation(async (image: string) => image)
  })

  it('normalizes the base URL and avoids duplicated /v1', () => {
    expect(buildOpenLuxUrl('https://api.openlux.ai/v1', '/images/generations'))
      .toBe('https://api.openlux.ai/v1/images/generations')
    expect(buildOpenLuxUrl('https://proxy.example.com/v1/', '/v1/images/edits'))
      .toBe('https://proxy.example.com/v1/images/edits')
    expect(buildOpenLuxUrl(undefined, 'images/generations'))
      .toBe('https://api.openlux.ai/v1/images/generations')
  })

  it('maps platform options to documented OpenLux fields', () => {
    expect(buildOpenLuxImageFields({
      prompt: 'a sky',
      options: { aspectRatio: '16:9', quality: 'HIGH', outputFormat: 'jpg', n: 2 },
    })).toMatchObject({
      prompt: 'a sky',
      n: 2,
      size: '2048x1152',
      quality: 'high',
      format: 'jpeg',
      response_format: 'url',
    })

    expect(buildOpenLuxImageFields({
      prompt: 'a sky',
      options: { size: '1024x1024', responseFormat: 'b64_json', background: 'transparent', moderation: 'low' },
    })).toMatchObject({
      size: '1024x1024',
      response_format: 'b64_json',
      background: 'transparent',
      moderation: 'low',
    })
  })

  it('maps custom pixel sizes to size and rejects unsupported sizes', () => {
    expect(buildOpenLuxImageFields({
      prompt: 'a sky',
      options: { size: '1280x720' },
    })).toEqual(expect.objectContaining({ size: '1280x720' }))

    expect(() => buildOpenLuxImageFields({ prompt: 'a sky', options: { size: '1000x1000' } }))
      .toThrow('OPENLUX_IMAGE_SIZE_INVALID')
    expect(() => buildOpenLuxImageFields({ prompt: 'a sky', options: { size: '100x3840' } }))
      .toThrow('OPENLUX_IMAGE_SIZE_INVALID')
    expect(() => buildOpenLuxImageFields({ prompt: 'a sky', options: { size: 'wide' } }))
      .toThrow('OPENLUX_IMAGE_SIZE_UNSUPPORTED')
  })

  it('validates prompt, n, quality, format and response format before requesting', async () => {
    expect(() => buildOpenLuxImageFields({ prompt: '   ' })).toThrow('OPENLUX_IMAGE_PROMPT_REQUIRED')
    expect(() => buildOpenLuxImageFields({ prompt: 'x', options: { n: 0 } })).toThrow('OPENLUX_IMAGE_N_INVALID')
    expect(() => buildOpenLuxImageFields({ prompt: 'x', options: { quality: 'ultra' } }))
      .toThrow('OPENLUX_IMAGE_QUALITY_UNSUPPORTED')
    expect(() => buildOpenLuxImageFields({ prompt: 'x', options: { outputFormat: 'gif' } }))
      .toThrow('OPENLUX_IMAGE_FORMAT_UNSUPPORTED')
    expect(() => buildOpenLuxImageFields({ prompt: 'x', options: { responseFormat: 'file' } }))
      .toThrow('OPENLUX_IMAGE_RESPONSE_FORMAT_UNSUPPORTED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits JSON generations to the official endpoint with an authenticated header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 'img_req_1',
      data: [{ url: 'https://cdn.example.com/one.png' }],
    }))

    const result = await generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'draw sky',
      options: {
        provider: 'openlux',
        modelId: 'gpt-image-2.5-sunburst',
        aspectRatio: '16:9',
        quality: 'high',
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openlux.ai/v1/images/generations')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer openlux-secret-key-for-test',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gpt-image-2.5-sunburst',
      prompt: 'draw sky',
      size: '2048x1152',
      quality: 'high',
      response_format: 'url',
    })
    expect(result).toEqual({
      success: true,
      requestId: 'img_req_1',
      imageUrl: 'https://cdn.example.com/one.png',
    })
  })

  it('returns multiple urls and base64 images', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        { url: 'https://cdn.example.com/one.png' },
        { url: 'https://cdn.example.com/two.png' },
        { b64_json: 'QUJD' },
      ],
    }))

    const result = await generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'draw sky',
      options: { provider: 'openlux', modelId: 'gpt-image-2.5-flare', n: 3 },
    })

    expect(result.imageUrl).toBe('https://cdn.example.com/one.png')
    expect(result.imageUrls).toEqual([
      'https://cdn.example.com/one.png',
      'https://cdn.example.com/two.png',
      'data:image/png;base64,QUJD',
    ])
    expect(result.imageBase64).toBe('QUJD')
  })

  it('sends reference images and masks to the edits endpoint as multipart data', async () => {
    normalizeReferencesMock.mockResolvedValueOnce(['https://cdn.example.com/source.png'])
    normalizeMaskMock.mockResolvedValueOnce('https://cdn.example.com/mask.png')

    fetchMock
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(jsonResponse({
        id: 'img_edit_1',
        data: [{ url: 'https://cdn.example.com/edited.png' }],
      }))

    const result = await generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'replace window',
      referenceImages: ['https://cdn.example.com/source.png'],
      maskImage: 'https://cdn.example.com/mask.png',
      editMode: 'inpaint',
      options: { provider: 'openlux', modelId: 'gpt-image-2.5-sunburst', size: '1024x1024' },
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://cdn.example.com/source.png')
    expect(fetchMock.mock.calls[1][0]).toBe('https://cdn.example.com/mask.png')
    const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(url).toBe('https://api.openlux.ai/v1/images/edits')
    expect(init.headers).toEqual({ Authorization: 'Bearer openlux-secret-key-for-test' })
    const form = init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('model')).toBe('gpt-image-2.5-sunburst')
    expect(form.get('prompt')).toBe('replace window')
    expect(form.get('size')).toBe('1024x1024')
    expect(form.getAll('image')).toHaveLength(1)
    expect(form.getAll('mask')).toHaveLength(1)
    expect(result).toMatchObject({ success: true, requestId: 'img_edit_1', imageUrl: 'https://cdn.example.com/edited.png' })
  })

  it('rejects oversized and non-image edit sources before submitting a paid request', async () => {
    normalizeReferencesMock.mockResolvedValue(['https://cdn.example.com/source.png'])
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1]), {
      headers: { 'content-type': 'text/html' },
    }))

    await expect(generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'replace window',
      referenceImages: ['asset://source'],
      options: { provider: 'openlux', modelId: 'gpt-image-2.5-sunburst' },
    })).rejects.toThrow('OPENLUX_IMAGE_SOURCE_TYPE_UNSUPPORTED')

    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1]), {
      headers: { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024 + 1) },
    }))
    await expect(generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'replace window',
      referenceImages: ['asset://source'],
      options: { provider: 'openlux', modelId: 'gpt-image-2.5-sunburst' },
    })).rejects.toThrow('OPENLUX_IMAGE_SOURCE_TOO_LARGE')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([url]) => url === 'https://cdn.example.com/source.png')).toBe(true)
  })

  it('enforces the sixteen reference image limit', async () => {
    normalizeReferencesMock.mockResolvedValueOnce(
      Array.from({ length: 17 }, (_, index) => `https://cdn.example.com/${index}.png`),
    )

    await expect(generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'draw sky',
      referenceImages: Array.from({ length: 17 }, (_, index) => `asset://${index}`),
      options: { provider: 'openlux', modelId: 'gpt-image-2.5-flare' },
    })).rejects.toThrow('OPENLUX_IMAGE_REFERENCE_LIMIT')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires exactly one source and a mask for inpaint edits', async () => {
    await expect(generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'replace window',
      editMode: 'inpaint',
      options: { provider: 'openlux', modelId: 'gpt-image-2.5-sunburst' },
    })).rejects.toThrow('OPENLUX_IMAGE_INPAINT_INVALID')

    normalizeReferencesMock.mockResolvedValueOnce([
      'https://cdn.example.com/a.png',
      'https://cdn.example.com/b.png',
    ])
    await expect(generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'replace window',
      referenceImages: ['a', 'b'],
      maskImage: 'https://cdn.example.com/mask.png',
      editMode: 'inpaint',
      options: { provider: 'openlux', modelId: 'gpt-image-2.5-sunburst' },
    })).rejects.toThrow('OPENLUX_IMAGE_INPAINT_INVALID')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps timeouts to a stable error without leaking the API key', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))

    const error = await generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'draw sky',
      options: { provider: 'openlux', modelId: 'gpt-image-2.5-flare' },
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('OPENLUX_IMAGE_TIMEOUT')
    expect((error as Error).message).not.toContain('openlux-secret-key-for-test')
  })

  it('never includes the provider key in HTTP error messages', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'invalid token' } }, 401))

    const error = await generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'draw sky',
      options: { provider: 'openlux', modelId: 'gpt-image-2.5-flare' },
    }).catch((caught: unknown) => caught)

    expect((error as Error).message).toContain('OPENLUX_HTTP_ERROR(401)')
    expect((error as Error).message).not.toContain('openlux-secret-key-for-test')
  })

  it('rejects empty and malformed provider responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))
    await expect(generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'draw sky',
      options: { provider: 'openlux', modelId: 'gpt-image-2.5-flare' },
    })).rejects.toThrow('OPENLUX_IMAGE_RESULT_EMPTY')

    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 200 }))
    await expect(generateOpenLuxImage({
      userId: 'user-1',
      prompt: 'draw sky',
      options: { provider: 'openlux', modelId: 'gpt-image-2.5-flare' },
    })).rejects.toThrow('OPENLUX_RESPONSE_INVALID_JSON')
  })
})
