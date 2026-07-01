import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getTextLlmRuntimeInfo,
  isDevelopmentTextLlmRuntime,
  readDevelopmentTextLlmConfig,
  resolveLlmRuntimeMode,
  resolveTextLlmRuntime,
} from '@/lib/llm/mode-config'

describe('llm mode config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves explicit development mode to the ghc gpt-5.5 text runtime', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('LLM_RUNTIME_MODE', 'development')
    vi.stubEnv('DEV_TEXT_LLM_BASE_URL', 'http://localhost:8313/v1')
    vi.stubEnv('DEV_TEXT_LLM_MODEL', 'gpt-5.5')
    vi.stubEnv('DEV_TEXT_LLM_PROTOCOL', 'responses')

    const runtime = resolveTextLlmRuntime(null)

    expect(resolveLlmRuntimeMode()).toBe('development')
    expect(isDevelopmentTextLlmRuntime(runtime)).toBe(true)
    expect(getTextLlmRuntimeInfo(runtime)).toEqual({
      mode: 'development',
      provider: 'dev_ghc_api',
      modelId: 'gpt-5.5',
      modelKey: 'dev_ghc_api::gpt-5.5',
      baseUrl: 'http://localhost:8313/v1',
      protocol: 'responses',
    })
  })

  it('keeps configured mode independent of legacy dev text flags', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('LLM_RUNTIME_MODE', 'configured')
    vi.stubEnv('DEV_TEXT_LLM_ENABLED', 'true')

    const runtime = resolveTextLlmRuntime('analysis-model')

    expect(resolveLlmRuntimeMode()).toBe('configured')
    expect(isDevelopmentTextLlmRuntime(runtime)).toBe(false)
    expect(getTextLlmRuntimeInfo(runtime)).toEqual({
      mode: 'configured',
      provider: 'configured_model',
      modelId: 'analysis-model',
      modelKey: 'analysis-model',
    })
  })

  it('preserves DEV_TEXT_LLM_ENABLED as a backward-compatible mode switch', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DEV_TEXT_LLM_ENABLED', 'true')

    expect(resolveLlmRuntimeMode()).toBe('development')

    vi.stubEnv('DEV_TEXT_LLM_ENABLED', 'false')

    expect(resolveLlmRuntimeMode()).toBe('configured')
  })

  it('defaults the development text model to ghc gpt-5.5 responses without streaming', () => {
    vi.stubEnv('NODE_ENV', 'test')

    expect(readDevelopmentTextLlmConfig()).toEqual({
      baseUrl: 'http://localhost:8313/v1',
      apiKey: 'dummy',
      model: 'gpt-5.5',
      protocol: 'responses',
      stream: false,
    })
  })
})
