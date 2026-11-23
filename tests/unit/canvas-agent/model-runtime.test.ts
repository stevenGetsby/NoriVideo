import { beforeEach, expect, it, vi } from 'vitest'
import { getCanvasAgentModelCatalog, resolveCanvasAgentLanguageModel } from '@/lib/canvas-agent/model-runtime'

const fixtures = vi.hoisted(() => ({
  configs: vi.fn(),
  chat: vi.fn((id: string) => `chat/${id}`),
  responses: vi.fn((id: string) => `responses/${id}`),
  sdk: vi.fn(),
  entry: vi.fn(),
  price: vi.fn(),
}))
vi.mock('@/lib/service-config', () => ({ readServiceConfig: fixtures.configs }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: fixtures.sdk }))
vi.mock('@/lib/model-pricing/catalog', () => ({ findBuiltinPricingCatalogEntry: fixtures.entry }))
vi.mock('@/lib/model-pricing/lookup', () => ({ resolveBuiltinPricing: fixtures.price }))
vi.mock('@/lib/canvas-agent/provider-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/canvas-agent/provider-registry')>()
  return {
    ...actual,
    CANVAS_AGENT_MODEL_CANDIDATES: [
      { providerId: 'deepseek', modelId: 'fixture-ds', displayName: 'Fixture DS', protocol: 'chat-completions', toolStreamingVerified: true },
      { providerId: 'kimi', modelId: 'fixture-kimi', displayName: 'Fixture Kimi', protocol: 'chat-completions', toolStreamingVerified: true },
      { providerId: 'openai', modelId: 'fixture-gpt', displayName: 'Fixture GPT', protocol: 'responses', toolStreamingVerified: true },
    ],
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  fixtures.sdk.mockReturnValue({ chat: fixtures.chat, responses: fixtures.responses })
  fixtures.entry.mockReturnValue({})
  fixtures.price.mockReturnValue({ status: 'resolved', amount: 1 })
  fixtures.configs.mockReturnValue({ llm: {
    providers: ['deepseek', 'kimi', 'openai'].map((id) => ({ id, apiKey: 'local-fixture-key', baseUrl: 'https://not-the-official.example' })),
    modelRouting: { 'nori::canvas-agent': 'deepseek::fixture-ds' },
    agentModels: {
      'deepseek::fixture-ds': { canvasAgent: true },
      'kimi::fixture-kimi': { canvasAgent: true },
      'openai::fixture-gpt': { canvasAgent: true, supportsTemperature: true },
    },
  } })
})

it.each([
  [undefined, 'chat/fixture-ds', 'https://api.deepseek.com/v1'],
  ['kimi::fixture-kimi', 'chat/fixture-kimi', 'https://api.moonshot.ai/v1'],
  ['openai::fixture-gpt', 'responses/fixture-gpt', 'https://api.openai.com/v1'],
])('uses the pinned adapter for %s without accepting arbitrary endpoints', async (requestedModelKey, languageModel, baseURL) => {
  const selected = await resolveCanvasAgentLanguageModel({ userId: 'fixture-actor', requestedModelKey })
  expect(selected).toMatchObject({ modelKey: requestedModelKey ?? 'deepseek::fixture-ds', languageModel })
  expect(fixtures.sdk).toHaveBeenCalledWith(expect.objectContaining({ baseURL }))
  expect(fixtures.configs).toHaveBeenCalledOnce()
  expect(JSON.stringify(selected)).not.toContain('local-fixture-key')
})

it('will not start a provider or borrow a different provider’s price when an output price is missing', async () => {
  fixtures.price.mockImplementation((input) => input.selections.tokenType === 'output' ? { status: 'missing_capability_match' } : { status: 'resolved', amount: 1 })
  expect(getCanvasAgentModelCatalog().defaultModelKey).toBeNull()
  await expect(resolveCanvasAgentLanguageModel({ userId: 'fixture-actor', requestedModelKey: 'openai::fixture-gpt' })).rejects.toThrow(/MODEL_PRICING_MISSING/)
  expect(fixtures.sdk).not.toHaveBeenCalled()
})
