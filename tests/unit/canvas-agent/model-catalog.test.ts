import { expect, it } from 'vitest'
import { buildCanvasAgentModelCatalog, selectCanvasAgentModel, type CanvasAgentCandidate } from '@/lib/canvas-agent/model-catalog'

const model = {
  providerId: 'deepseek', modelId: 'fixture-chat', displayName: 'Fixture Chat',
  protocol: 'chat-completions', toolStreamingVerified: true,
} satisfies CanvasAgentCandidate
const key = 'deepseek::fixture-chat'

const state = {
  candidates: [model],
  settings: { [key]: { canvasAgent: true, supportsTemperature: false } },
  defaultModelKey: key,
  hasKey: () => true,
  hasPricing: () => true,
}

it('publishes only explicitly enabled, supported models and keeps the selected model key intact', () => {
  const catalog = buildCanvasAgentModelCatalog(state)
  expect(catalog.defaultModelKey).toBe(key)
  expect(selectCanvasAgentModel(catalog)).toMatchObject({ modelKey: key, supportsTemperature: false, protocol: 'chat-completions' })
  expect(() => selectCanvasAgentModel(catalog, 'nori::canvas-agent')).toThrow(/MODEL_NOT_ALLOWED/)
  expect(buildCanvasAgentModelCatalog({ ...state, settings: {} }).models[0]).toMatchObject({ enabled: false })
})

it('requires keys, input/output prices, and verified tool streaming before use', () => {
  const missingKey = buildCanvasAgentModelCatalog({ ...state, hasKey: () => false })
  const missingPrice = buildCanvasAgentModelCatalog({ ...state, hasPricing: () => false })
  const unverified = buildCanvasAgentModelCatalog({ ...state, candidates: [{ ...model, toolStreamingVerified: false }] })
  expect(missingKey.models[0]).toMatchObject({ enabled: false, unavailableReason: 'MODEL_UNAVAILABLE' })
  expect(missingPrice.models[0]).toMatchObject({ enabled: false, unavailableReason: 'MODEL_PRICING_MISSING' })
  expect(unverified.models[0]).toMatchObject({ enabled: false, unavailableReason: 'TOOL_STREAMING_UNVERIFIED' })
  expect(() => selectCanvasAgentModel(missingPrice, key)).toThrow(/MODEL_PRICING_MISSING/)
  expect(() => selectCanvasAgentModel(unverified)).toThrow(/CANVAS_AGENT_MODEL_NOT_CONFIGURED/)
})

it('will not route an OpenAI candidate through Chat Completions or a Kimi candidate through Responses', () => {
  const candidates: CanvasAgentCandidate[] = [
    { ...model, providerId: 'openai', modelId: 'fixture-openai', protocol: 'chat-completions' },
    { ...model, providerId: 'kimi', modelId: 'fixture-kimi', protocol: 'responses' },
  ]
  const catalog = buildCanvasAgentModelCatalog({ ...state, candidates, settings: {
    'openai::fixture-openai': { canvasAgent: true },
    'kimi::fixture-kimi': { canvasAgent: true },
  } })
  expect(catalog.models.map((item) => item.unavailableReason)).toEqual(['MODEL_PROTOCOL_UNSUPPORTED', 'MODEL_PROTOCOL_UNSUPPORTED'])
})
