import { describe, expect, it } from 'vitest'

import { getTestModeModelKeys } from '@/lib/test-mode'

describe('test-mode model defaults', () => {
  it('uses Lumina GPT-5.5 for analysis', () => {
    expect(getTestModeModelKeys().analysisModel).toBe('lumina::gpt-5.5')
  })
})
