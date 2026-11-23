import { createOpenAI } from '@ai-sdk/openai'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import { resolveBuiltinPricing } from '@/lib/model-pricing/lookup'
import { readServiceConfig, type ServiceConfig } from '@/lib/service-config'
import {
  buildCanvasAgentModelCatalog,
  CANVAS_AGENT_SELECTION_KEY,
  CanvasAgentModelSelectionError,
  selectCanvasAgentModel,
  type CanvasAgentProvider,
} from './model-catalog'
import { CANVAS_AGENT_MODEL_CANDIDATES, CANVAS_AGENT_PROVIDER_PRESETS } from './provider-registry'

export function usableCanvasAgentKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7E]+$/.test(value.trim())
    && !/^(?:your[-_ ]|placeholder$|replace[-_ ]?me$)/i.test(value.trim())
}

function credential(config: ServiceConfig, provider: CanvasAgentProvider) {
  return [
    config.llm?.providers?.find((item) => item.id === provider)?.apiKey,
    process.env[CANVAS_AGENT_PROVIDER_PRESETS[provider].envKey],
  ].find(usableCanvasAgentKey)?.trim()
}

function hasTextPricing(key: string) {
  const [provider, model] = key.split('::')
  // Do not implicitly borrow another provider's same-name model price.
  if (!findBuiltinPricingCatalogEntry('text', provider, model)) return false
  return (['input', 'output'] as const).every((tokenType) => {
    const price = resolveBuiltinPricing({ apiType: 'text', model: key, selections: { tokenType } })
    return price.status === 'resolved' && Number.isFinite(price.amount) && price.amount > 0
  })
}

export function getCanvasAgentModelCatalog(config = readServiceConfig()) {
  return buildCanvasAgentModelCatalog({
    candidates: CANVAS_AGENT_MODEL_CANDIDATES,
    settings: config.llm?.agentModels ?? {},
    defaultModelKey: config.llm?.modelRouting?.[CANVAS_AGENT_SELECTION_KEY],
    hasKey: (provider) => Boolean(credential(config, provider)),
    hasPricing: hasTextPricing,
  })
}

export async function resolveCanvasAgentLanguageModel(input: { userId: string; requestedModelKey?: string }) {
  // Selection and the credentials must come from the same configuration
  // snapshot for the entire request.
  const config = readServiceConfig()
  const selected = selectCanvasAgentModel(getCanvasAgentModelCatalog(config), input.requestedModelKey)
  const apiKey = credential(config, selected.providerId)
  if (!apiKey) throw new CanvasAgentModelSelectionError('MODEL_UNAVAILABLE')
  const adapter = createOpenAI({
    apiKey,
    baseURL: CANVAS_AGENT_PROVIDER_PRESETS[selected.providerId].baseURL,
    name: selected.providerId,
    ...(selected.providerId === 'deepseek' ? {
      // This product does not store or resend private reasoning. Use the
      // vendor's non-thinking mode rather than breaking tool continuations
      // that would otherwise require the previous reasoning payload.
      fetch: (url: RequestInfo | URL, init?: RequestInit) => fetch(url, typeof init?.body === 'string'
        ? { ...init, body: JSON.stringify({ ...JSON.parse(init.body), thinking: { type: 'disabled' } }) }
        : init),
    } : {}),
  })
  return {
    ...selected,
    selectionKey: CANVAS_AGENT_SELECTION_KEY,
    languageModel: selected.protocol === 'responses' ? adapter.responses(selected.modelId) : adapter.chat(selected.modelId),
  }
}
