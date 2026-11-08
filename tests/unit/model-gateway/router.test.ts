import { describe, expect, it } from 'vitest'
import { isCompatibleProvider, resolveModelGatewayRoute } from '@/lib/model-gateway'

describe('model-gateway router', () => {
  it('routes only the supported DeepSeek provider to openai-compat', () => {
    expect(isCompatibleProvider('deepseek')).toBe(true)
    expect(isCompatibleProvider('deepseek:ds-1')).toBe(true)
    expect(resolveModelGatewayRoute('deepseek')).toBe('openai-compat')
    expect(resolveModelGatewayRoute('deepseek:ds-1')).toBe('openai-compat')
  })

  it('does not restore retired openai-compatible provider aliases', () => {
    for (const provider of ['openai-compatible', 'openai-compatible:oa-1', 'ghc', 'hfsy']) {
      expect(isCompatibleProvider(provider)).toBe(false)
      expect(resolveModelGatewayRoute(provider)).toBe('official')
    }
  })

  it('keeps gemini-compatible providers on official route', () => {
    expect(isCompatibleProvider('gemini-compatible')).toBe(false)
    expect(isCompatibleProvider('gemini-compatible:gm-1')).toBe(false)
    expect(resolveModelGatewayRoute('gemini-compatible:gm-1')).toBe('official')
  })

  it('keeps official providers on official route', () => {
    expect(isCompatibleProvider('google')).toBe(false)
    expect(isCompatibleProvider('ark')).toBe(false)
    expect(isCompatibleProvider('bailian')).toBe(false)
    expect(isCompatibleProvider('siliconflow')).toBe(false)
    expect(resolveModelGatewayRoute('google')).toBe('official')
    expect(resolveModelGatewayRoute('ark')).toBe('official')
    expect(resolveModelGatewayRoute('bailian')).toBe('official')
    expect(resolveModelGatewayRoute('siliconflow')).toBe('official')
  })
})
