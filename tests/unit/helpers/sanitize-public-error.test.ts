import { describe, expect, it } from 'vitest'
import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'

describe('public provider errors', () => {
  it('keeps actionable error info but never echoes signed media query strings', () => {
    const error = sanitizePublicError('HTTP 400: cannot fetch https://bucket.tos-cn-beijing.volces.com/image.png?X-Tos-Credential=TEST_SECRET&X-Tos-Signature=SIGNED_SECRET')
    expect(error).toContain('HTTP 400')
    expect(error).toContain('/image.png')
    expect(error).not.toContain('TEST_SECRET')
    expect(error).not.toContain('SIGNED_SECRET')
    expect(sanitizePublicError('请求错误 kz-TESTKEY0123456789 Bearer TESTTOKEN')).not.toContain('TESTKEY')
  })

  it('hides generation provider names and durable routing IDs without losing HTTP details', () => {
    const error = sanitizePublicError('KUAIZI_HTTP_ERROR(400): Kuaizi rejected the video; see https://aiopenapi.kuaizi.cn/help')
    expect(error).toContain('GENERATION_SERVICE_HTTP_ERROR(400)')
    expect(error).toContain('GENERATION_SERVICE rejected the video')
    expect(error).toContain('[已隐藏服务地址]')
    expect(error).not.toMatch(/kuaizi|openlux|筷子/i)
    expect(sanitizePublicError('OPENLUX_IMAGE_TIMEOUT')).toBe('GENERATION_SERVICE_IMAGE_TIMEOUT')
    expect(sanitizePublicError('External task failed: KUAIZI:VIDEO:cHJvdmlkZXI:bW9kZWw:cgt:123')).not.toContain('KUAIZI')
  })

  it('hides tgg credentials, upstream task ids and service addresses', () => {
    expect(sanitizePublicError('Bearer sk-abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
    expect(sanitizePublicError(' leaked sk-abcdefghijklmnop ')).toBe(' leaked [已隐藏密钥] ')
    const url = sanitizePublicError('failed https://tggtoken.org/v1/videos/x?token=1')
    expect(url).not.toContain('tggtoken.org')
    expect(url).not.toContain('token=1')
    expect(url).toContain('[已隐藏服务地址]')
    expect(sanitizePublicError('TGG:VIDEO:YQ:Yg:task_1')).toBe('[已隐藏上游任务标识]')
    expect(sanitizePublicError('TGG_HTTP_ERROR(502): upstream down')).toContain('GENERATION_SERVICE_HTTP_ERROR(502)')
  })

  it('replaces standalone tgg brand words but keeps longer identifiers intact', () => {
    expect(sanitizePublicError('视频由 tgg 生成')).not.toMatch(/\btgg\b/i)
    expect(sanitizePublicError('视频由 tgg 生成')).toBe('视频由 GENERATION_SERVICE 生成')
    expect(sanitizePublicError('tggtoken.org')).toBe('[已隐藏服务地址]')
  })
})
