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
})
