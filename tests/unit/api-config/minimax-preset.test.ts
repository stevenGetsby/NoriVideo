import { describe, expect, it } from 'vitest'
import { PRESET_MODELS, PRESET_PROVIDERS } from '@/app/[locale]/profile/components/api-config/types'
import { MODEL_PRESETS, MODEL_PROVIDER_PRESETS } from '@/lib/model-provider-contract'

describe('api-config minimax preset', () => {
  it('does not reintroduce an unsupported MiniMax provider into the current registry', () => {
    expect(PRESET_PROVIDERS.some((provider) => String(provider.id) === 'minimax')).toBe(false)
    expect(PRESET_PROVIDERS.map((provider) => provider.id)).toEqual(MODEL_PROVIDER_PRESETS.map((provider) => provider.id))
  })

  it('projects exactly the supported model registry instead of advertising retired models', () => {
    const minimaxLlmModelIds = PRESET_MODELS
      .filter((model) => model.provider === 'minimax' && model.type === 'llm')
      .map((model) => model.modelId)

    expect(minimaxLlmModelIds).toEqual([])
    expect(PRESET_MODELS).toEqual(MODEL_PRESETS.map(({ modelId, name, type, provider }) => ({ modelId, name, type, provider })))
  })
})
