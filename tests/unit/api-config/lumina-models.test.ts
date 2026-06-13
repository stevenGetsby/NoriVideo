import { describe, expect, it } from 'vitest'
import {
  getLuminaAnthropicCompatibleModelName,
  LUMINA_ANTHROPIC_COMPATIBLE_MODELS,
  LUMINA_ANTHROPIC_COMPATIBLE_TEXT_MODELS,
  LUMINA_ANTHROPIC_COMPATIBLE_VISION_MODELS,
  isLuminaAnthropicCompatibleTextCapableModel,
  isLuminaAnthropicCompatibleVisionCapableModel,
  normalizeLuminaAnthropicCompatibleModelId,
} from '@/lib/lumina-anthropic-compatible-models'

describe('Lumina model presets', () => {
  it('uses model-only display names without protocol labels', () => {
    for (const model of LUMINA_ANTHROPIC_COMPATIBLE_MODELS) {
      expect(model.name).not.toContain('Text ·')
      expect(model.name).not.toContain('Vision ·')
      expect(model.name).not.toContain('OpenAI')
      expect(model.name).not.toContain('Anthropic')
    }
  })

  it('keeps text and image-understanding presets in separate stable groups', () => {
    expect(LUMINA_ANTHROPIC_COMPATIBLE_TEXT_MODELS.map((model) => model.modelId)).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'kimi-k2.5',
    ])
    expect(LUMINA_ANTHROPIC_COMPATIBLE_VISION_MODELS.map((model) => model.modelId)).toEqual([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gemini-3.1-pro-preview',
      'gemini-3-pro-preview',
      'gemini-3-flash',
    ])
  })

  it('normalizes legacy Lumina ids that used the wrong route or unavailable suffix', () => {
    expect(normalizeLuminaAnthropicCompatibleModelId('deepseek-v4-flash[1M]')).toBe('deepseek-v4-flash')
    expect(normalizeLuminaAnthropicCompatibleModelId('deepseek-v4-flash-openai')).toBe('deepseek-v4-flash')
    expect(normalizeLuminaAnthropicCompatibleModelId('deepseek-v4-pro-anthropic')).toBe('deepseek-v4-pro')
    expect(getLuminaAnthropicCompatibleModelName('deepseek-v4-flash-openai')).toBe('DeepSeek V4 Flash')
  })

  it('treats image-understanding models as text-capable without duplicating presets', () => {
    expect(isLuminaAnthropicCompatibleTextCapableModel('gpt-5.5')).toBe(true)
    expect(isLuminaAnthropicCompatibleVisionCapableModel('gpt-5.5')).toBe(true)
    expect(isLuminaAnthropicCompatibleTextCapableModel('gemini-3-flash')).toBe(true)
    expect(isLuminaAnthropicCompatibleVisionCapableModel('gemini-3-flash')).toBe(true)
    expect(isLuminaAnthropicCompatibleVisionCapableModel('claude-sonnet-4-6')).toBe(false)
    expect(LUMINA_ANTHROPIC_COMPATIBLE_MODELS.filter((model) => model.modelId === 'gpt-5.5')).toHaveLength(1)
    expect(LUMINA_ANTHROPIC_COMPATIBLE_MODELS.filter((model) => model.modelId === 'gemini-3-flash-preview')).toHaveLength(0)
  })
})
