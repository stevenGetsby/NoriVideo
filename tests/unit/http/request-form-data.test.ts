import { describe, expect, it } from 'vitest'
import { readRequestFormData } from '@/lib/http/request-form-data'
import { ApiError } from '@/lib/api-errors'
import { readFileSync } from 'node:fs'
import { MAX_IMAGE_PIXELS, assertFrameosImagePixelLimit } from '@/lib/frameos/material-upload'

function multipartRequest(body: string, boundary = 'test-boundary') {
  return new Request('http://localhost/api/frameos/materials', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  })
}

describe('readRequestFormData', () => {
  it('returns parsed fields for an intact multipart body', async () => {
    const body = [
      '--test-boundary',
      'Content-Disposition: form-data; name="title"',
      '',
      '场景图',
      '--test-boundary',
      'Content-Disposition: form-data; name="file"; filename="a.png"',
      'Content-Type: image/png',
      '',
      'binary',
      '--test-boundary--',
      '',
    ].join('\r\n')
    const form = await readRequestFormData(multipartRequest(body), { fileSizeLabel: '200MB' })
    expect(form.get('title')).toBe('场景图')
    expect(form.get('file')).toBeInstanceOf(File)
  })

  it('turns a truncated multipart body into an actionable ApiError', async () => {
    // 中间件截断请求体后，结束分隔符丢失，undici 会抛出解析错误。
    const truncated = [
      '--test-boundary',
      'Content-Disposition: form-data; name="title"',
      '',
      '大营1',
    ].join('\r\n')
    await expect(readRequestFormData(multipartRequest(truncated), { fileSizeLabel: '200MB' }))
      .rejects.toMatchObject({
        name: 'ApiError',
        code: 'INVALID_PARAMS',
        message: expect.stringContaining('单个文件上限为 200MB'),
      })
  })

  it('keeps unrelated errors untouched', async () => {
    const failing = {
      formData: async () => { throw new RangeError('boom') },
    } as unknown as Request
    await expect(readRequestFormData(failing, { fileSizeLabel: '200MB' })).rejects.toThrow('boom')
    await expect(readRequestFormData(failing, { fileSizeLabel: '200MB' })).rejects.not.toBeInstanceOf(ApiError)
  })

  it('keeps the Next middleware body-clone limit above the material upload cap', () => {
    // Next 默认 10MB 会静默截断上传请求体；该配置必须覆盖 200MB 的素材上限。
    const config = readFileSync('next.config.ts', 'utf8')
    const match = config.match(/middlewareClientMaxBodySize:\s*'(\d+)mb'/)
    expect(match).not.toBeNull()
    expect(Number(match![1]) * 1024 * 1024).toBeGreaterThan(200 * 1024 * 1024)
  })

  it('distinguishes oversized image dimensions from unreadable image files', () => {
    expect(() => assertFrameosImagePixelLimit(4000, 3000)).not.toThrow()
    expect(() => assertFrameosImagePixelLimit(0, 3000)).toThrow('无法读取这张图片')
    expect(() => assertFrameosImagePixelLimit(9000, 7000)).toThrow(/图片尺寸过大（9000×7000）/)
    expect(9000 * 7000).toBeGreaterThan(MAX_IMAGE_PIXELS)
  })

  it('routes material multipart uploads through the shared reader', () => {
    expect(readFileSync('src/lib/frameos/material-upload.ts', 'utf8'))
      .toContain("readRequestFormData(request, { fileSizeLabel: '200MB' })")
    expect(readFileSync('src/app/api/video-enhance/route.ts', 'utf8'))
      .not.toContain('submitMediaKitEnhanceVideoTask')
  })
})
