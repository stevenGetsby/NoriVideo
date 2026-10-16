import { describe, expect, it } from 'vitest'

import { getTestModeModelKeys } from '@/lib/test-mode'

describe('test-mode model defaults', () => {
  it('uses the configured HFSY GPT-5.5 route for analysis', () => {
    expect(getTestModeModelKeys().analysisModel).toBe('hfsy::gpt-5.5')
  })
})
