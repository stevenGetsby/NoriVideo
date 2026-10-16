import { describe, expect, it } from 'vitest'
import { canonicalTosQuery } from '@/lib/storage/providers/tos'

describe('TOS playback response signing', () => {
  it('sorts mixed-case query keys by bytes rather than locale collation', () => {
    const params = new URLSearchParams({
      'response-content-type': 'video/mp4',
      'X-Tos-SignedHeaders': 'host',
      'response-content-disposition': 'inline',
      'X-Tos-Algorithm': 'TOS4-HMAC-SHA256',
    })
    expect(canonicalTosQuery(params)).toBe(
      'X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-SignedHeaders=host&response-content-disposition=inline&response-content-type=video%2Fmp4',
    )
  })
})
