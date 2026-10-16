import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const storage = vi.hoisted(() => ({
  getSignedObjectUrl: vi.fn(async (key: string) => `https://storage.test/${key}`),
  uploadObject: vi.fn(async (_body: Buffer, key: string) => key),
}))
vi.mock('@/lib/storage', () => storage)
import { prepareKuaiziSeedanceImage } from '@/lib/media/kuaizi-seedance-image'

async function image(width: number, height: number, alpha = false) {
  const pipeline = sharp({ create: {
    width, height, channels: alpha ? 4 : 3,
    background: { r: 50, g: 80, b: 120, alpha: alpha ? 0.5 : 1 },
  } })
  return alpha ? pipeline.png().toBuffer() : pipeline.jpeg().toBuffer()
}

describe('Kuaizi Seedance real-image dimension preparation', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    [6336, 2688, 6000, 2545],
    [2688, 6336, 2545, 6000],
    [200, 100, 600, 300],
    [100, 200, 300, 600],
  ])('fits %sx%s to %sx%s using a separate object', async (width, height, expectedWidth, expectedHeight) => {
    const bytes = await image(width, height)
    fetchMock.mockResolvedValue(new Response(new Uint8Array(bytes)))
    const url = await prepareKuaiziSeedanceImage('https://inputs.test/original.jpg')
    expect(storage.uploadObject).toHaveBeenCalledTimes(1)
    const [derived, key, expiry, mime] = storage.uploadObject.mock.calls[0] as unknown as [Buffer, string, unknown, string]
    expect(await sharp(derived).metadata()).toMatchObject({ width: expectedWidth, height: expectedHeight, format: 'jpeg' })
    expect(key).toMatch(/^images\/seedance-reference\/[a-f0-9]{64}\.jpg$/)
    expect(mime).toBe('image/jpeg')
    expect(expiry).toBeUndefined()
    expect(url).toBe(`https://storage.test/${key}`)
    expect(bytes.equals(derived)).toBe(false)
  })

  it.each([[300, 6000], [6000, 300], [512, 512]])('does not re-encode valid %sx%s inputs', async (width, height) => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(await image(width, height))))
    await expect(prepareKuaiziSeedanceImage('https://inputs.test/valid.jpg')).resolves.toBe('https://inputs.test/valid.jpg')
    expect(storage.uploadObject).not.toHaveBeenCalled()
  })

  it('preserves transparency in the generated copy', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(await image(6100, 400, true))))
    await prepareKuaiziSeedanceImage('https://inputs.test/alpha.png')
    const [derived, key] = storage.uploadObject.mock.calls[0]
    expect(await sharp(derived).metadata()).toMatchObject({ width: 6000, height: 393, format: 'png', hasAlpha: true })
    expect(key).toMatch(/\.png$/)
  })

  it('applies EXIF rotation before fitting dimensions', async () => {
    const bytes = await sharp(await image(6336, 2688)).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    fetchMock.mockResolvedValue(new Response(new Uint8Array(bytes)))
    await prepareKuaiziSeedanceImage('https://inputs.test/rotated.jpg')
    expect(await sharp(storage.uploadObject.mock.calls[0][0]).metadata()).toMatchObject({ width: 2545, height: 6000 })
  })

  it.each([[6000, 299], [299, 6000]])('rejects extreme %sx%s without cropping or stretching', async (width, height) => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(await image(width, height))))
    await expect(prepareKuaiziSeedanceImage('https://inputs.test/wide.jpg')).rejects.toMatchObject({
      code: 'INVALID_PARAMS', message: expect.stringContaining('比例过于极端'),
    })
    expect(storage.uploadObject).not.toHaveBeenCalled()
  })

  it('passes asset URIs without network requests', async () => {
    await expect(prepareKuaiziSeedanceImage('asset://1800657071180349888')).resolves.toBe('asset://1800657071180349888')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects oversized declared and streamed bodies without uploading them', async () => {
    fetchMock.mockResolvedValueOnce(new Response('small', { headers: { 'content-length': String(40 * 1024 * 1024 + 1) } }))
    await expect(prepareKuaiziSeedanceImage('https://inputs.test/huge.png')).rejects.toThrow('40MB')
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(40 * 1024 * 1024 + 1)))
    await expect(prepareKuaiziSeedanceImage('https://inputs.test/stream.png')).rejects.toThrow('40MB')
    expect(storage.uploadObject).not.toHaveBeenCalled()
  })

  it('reports unavailable or corrupt inputs without leaking their signed URLs', async () => {
    const secretUrl = 'https://inputs.test/a.jpg?X-Tos-Signature=test-secret'
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
    await expect(prepareKuaiziSeedanceImage(secretUrl)).rejects.toMatchObject({
      code: 'INVALID_PARAMS', message: '参考图片读取失败（HTTP 404），请重新选择或上传图片。',
    })
    fetchMock.mockResolvedValueOnce(new Response('not an image'))
    await expect(prepareKuaiziSeedanceImage(secretUrl)).rejects.toThrow('无法解码')
    expect(storage.uploadObject).not.toHaveBeenCalled()
  })

  it('classifies network failures as retryable without exposing the original URL', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed: https://inputs.test/a.jpg?X-Tos-Signature=test-secret'))
    await expect(prepareKuaiziSeedanceImage('https://inputs.test/a.jpg')).rejects.toMatchObject({
      code: 'NETWORK_ERROR', message: '参考图片读取超时或连接失败，请稍后重试。',
    })
    expect(storage.uploadObject).not.toHaveBeenCalled()
  })
})
