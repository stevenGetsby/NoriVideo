import { describe, expect, it } from 'vitest'
import { isDiscoverableTextModel } from '@/lib/platform-services/discovery'

describe('platform service model discovery', () => {
  it('keeps every GHC GPT and Gemini text model', () => {
    expect(isDiscoverableTextModel('ghc', 'gpt-5.5')).toBe(true)
    expect(isDiscoverableTextModel('ghc', 'gpt-4-o-preview')).toBe(true)
    expect(isDiscoverableTextModel('ghc', 'gemini-3.5-flash')).toBe(true)
    expect(isDiscoverableTextModel('ghc', 'claude-sonnet-5')).toBe(false)
    expect(isDiscoverableTextModel('ghc', 'text-embedding-3-small')).toBe(false)
  })

  it('keeps DeepSeek chat models and rejects non-text capabilities', () => {
    expect(isDiscoverableTextModel('deepseek', 'deepseek-v4-flash')).toBe(true)
    expect(isDiscoverableTextModel('deepseek', 'deepseek-v4-pro')).toBe(true)
    expect(isDiscoverableTextModel('deepseek', 'deepseek-embedding')).toBe(false)
  })
})
