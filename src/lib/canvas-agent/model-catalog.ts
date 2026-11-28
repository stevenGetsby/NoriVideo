export const CANVAS_AGENT_SELECTION_KEY = 'nori::canvas-agent'

const protocols = { openlux: 'chat-completions', openai: 'responses' } as const
export type CanvasAgentProvider = keyof typeof protocols
export type CanvasAgentModelProtocol = (typeof protocols)[CanvasAgentProvider]

export type CanvasAgentCandidate = {
  providerId: CanvasAgentProvider
  modelId: string
  displayName: string
  protocol: CanvasAgentModelProtocol
  /** Set by the registered provider contract, never from editable settings. */
  toolStreamingVerified: boolean
}

export type CanvasAgentModelSettings = { canvasAgent?: boolean; supportsTemperature?: boolean }
type Unavailable = 'MODEL_PROTOCOL_UNSUPPORTED' | 'MODEL_UNAVAILABLE' | 'MODEL_PRICING_MISSING' | 'TOOL_STREAMING_UNVERIFIED'
type SelectionError = 'MODEL_NOT_ALLOWED' | 'CANVAS_AGENT_MODEL_NOT_CONFIGURED' | Unavailable
export type CanvasAgentModelCatalogEntry = CanvasAgentCandidate & {
  modelKey: string
  enabled: boolean
  default: boolean
  supportsTemperature: boolean
  unavailableReason: Unavailable | null
}
export type CanvasAgentModelCatalog = { defaultModelKey: string | null; models: CanvasAgentModelCatalogEntry[] }

export class CanvasAgentModelSelectionError extends Error {
  constructor(readonly code: SelectionError) {
    super(code)
    this.name = 'CanvasAgentModelSelectionError'
  }
}

export function buildCanvasAgentModelCatalog({
  candidates, settings, defaultModelKey, hasKey, hasPricing,
}: {
  candidates: readonly CanvasAgentCandidate[]
  settings: Readonly<Record<string, CanvasAgentModelSettings>>
  defaultModelKey?: string | null
  hasKey: (provider: CanvasAgentProvider, modelId?: string) => boolean
  hasPricing: (modelKey: string) => boolean
}): CanvasAgentModelCatalog {
  const models = candidates.map((candidate): CanvasAgentModelCatalogEntry => {
    const modelKey = `${candidate.providerId}::${candidate.modelId}`
    const flags = settings[modelKey]
    const unavailableReason = candidate.protocol !== protocols[candidate.providerId] ? 'MODEL_PROTOCOL_UNSUPPORTED'
      : !hasKey(candidate.providerId, candidate.modelId) ? 'MODEL_UNAVAILABLE'
        : !hasPricing(modelKey) ? 'MODEL_PRICING_MISSING'
          : !candidate.toolStreamingVerified ? 'TOOL_STREAMING_UNVERIFIED'
            : null
    const enabled = flags?.canvasAgent === true && unavailableReason === null
    return {
      ...candidate, modelKey, enabled, unavailableReason,
      default: enabled && modelKey === defaultModelKey,
      supportsTemperature: flags?.supportsTemperature === true,
    }
  })
  return { defaultModelKey: models.find((entry) => entry.default)?.modelKey ?? null, models }
}

export function selectCanvasAgentModel(catalog: CanvasAgentModelCatalog, requestedModelKey?: string) {
  const key = requestedModelKey ?? catalog.defaultModelKey
  if (!key) throw new CanvasAgentModelSelectionError('CANVAS_AGENT_MODEL_NOT_CONFIGURED')
  const selected = catalog.models.find((model) => model.modelKey === key)
  if (!selected) throw new CanvasAgentModelSelectionError('MODEL_NOT_ALLOWED')
  if (!selected.enabled) throw new CanvasAgentModelSelectionError(selected.unavailableReason ?? 'MODEL_NOT_ALLOWED')
  return selected
}
