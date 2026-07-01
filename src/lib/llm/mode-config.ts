const DEFAULT_DEV_TEXT_LLM_BASE_URL = 'http://localhost:8313/v1'
const DEFAULT_DEV_TEXT_LLM_API_KEY = 'dummy'
const DEFAULT_DEV_TEXT_LLM_MODEL = 'gpt-5.5'
const DEFAULT_DEV_TEXT_LLM_PROTOCOL: DevTextLlmProtocol = 'responses'

export const DEV_TEXT_LLM_PROVIDER = 'dev_ghc_api'

export type LlmRuntimeMode = 'development' | 'configured'
export type DevTextLlmProtocol = 'chat' | 'responses'

export type DevelopmentTextLlmConfig = {
  baseUrl: string
  apiKey: string
  model: string
  protocol: DevTextLlmProtocol
  stream: boolean
}

export type DevelopmentTextLlmRuntime = {
  mode: 'development'
  kind: 'dev-text'
  provider: typeof DEV_TEXT_LLM_PROVIDER
  modelId: string
  modelKey: string
  config: DevelopmentTextLlmConfig
}

export type ConfiguredTextLlmRuntime = {
  mode: 'configured'
  kind: 'configured-text'
  provider: 'configured_model'
  requestedModel: string | null | undefined
}

export type TextLlmRuntime = DevelopmentTextLlmRuntime | ConfiguredTextLlmRuntime

export type TextLlmRuntimeInfo = {
  mode: LlmRuntimeMode
  provider: string
  modelId: string
  modelKey: string
  baseUrl?: string
  protocol?: DevTextLlmProtocol
}

function readTrimmedEnv(key: string): string {
  return (process.env[key] || '').trim()
}

function parseBooleanFlag(value: string): boolean | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  if (!normalized) return null
  throw new Error(`BOOLEAN_ENV_INVALID: ${value}`)
}

function readDevTextLlmProtocol(): DevTextLlmProtocol {
  const protocol = readTrimmedEnv('DEV_TEXT_LLM_PROTOCOL').toLowerCase()
  if (!protocol) return DEFAULT_DEV_TEXT_LLM_PROTOCOL
  if (protocol === 'chat' || protocol === 'responses') return protocol
  throw new Error(`DEV_TEXT_LLM_PROTOCOL_INVALID: ${protocol}`)
}

export function readDevelopmentTextLlmConfig(): DevelopmentTextLlmConfig {
  const streamFlag = readTrimmedEnv('DEV_TEXT_LLM_STREAM')
  return {
    baseUrl: readTrimmedEnv('DEV_TEXT_LLM_BASE_URL') || DEFAULT_DEV_TEXT_LLM_BASE_URL,
    apiKey: readTrimmedEnv('DEV_TEXT_LLM_API_KEY') || DEFAULT_DEV_TEXT_LLM_API_KEY,
    model: readTrimmedEnv('DEV_TEXT_LLM_MODEL') || DEFAULT_DEV_TEXT_LLM_MODEL,
    protocol: readDevTextLlmProtocol(),
    stream: streamFlag ? parseBooleanFlag(streamFlag) === true : false,
  }
}

export function resolveLlmRuntimeMode(): LlmRuntimeMode {
  const configuredMode = readTrimmedEnv('LLM_RUNTIME_MODE').toLowerCase()
  if (configuredMode) {
    if (configuredMode === 'development' || configuredMode === 'dev' || configuredMode === 'local') {
      return 'development'
    }
    if (configuredMode === 'configured' || configuredMode === 'config' || configuredMode === 'production' || configuredMode === 'prod') {
      return 'configured'
    }
    throw new Error(`LLM_RUNTIME_MODE_INVALID: ${configuredMode}`)
  }

  const legacyDevEnabled = readTrimmedEnv('DEV_TEXT_LLM_ENABLED')
  if (legacyDevEnabled) {
    return parseBooleanFlag(legacyDevEnabled) ? 'development' : 'configured'
  }

  const lifecycleEvent = readTrimmedEnv('npm_lifecycle_event')
  if (process.env.NODE_ENV === 'development' || lifecycleEvent.startsWith('dev')) {
    return 'development'
  }
  return 'configured'
}

export function resolveTextLlmRuntime(
  requestedModel?: string | null,
): TextLlmRuntime {
  const mode = resolveLlmRuntimeMode()
  if (mode === 'development') {
    const config = readDevelopmentTextLlmConfig()
    return {
      mode,
      kind: 'dev-text',
      provider: DEV_TEXT_LLM_PROVIDER,
      modelId: config.model,
      modelKey: `${DEV_TEXT_LLM_PROVIDER}::${config.model}`,
      config,
    }
  }

  return {
    mode,
    kind: 'configured-text',
    provider: 'configured_model',
    requestedModel,
  }
}

export function isDevelopmentTextLlmRuntime(
  runtime: TextLlmRuntime,
): runtime is DevelopmentTextLlmRuntime {
  return runtime.kind === 'dev-text'
}

export function getTextLlmRuntimeInfo(runtime: DevelopmentTextLlmRuntime): TextLlmRuntimeInfo
export function getTextLlmRuntimeInfo(runtime: TextLlmRuntime): TextLlmRuntimeInfo
export function getTextLlmRuntimeInfo(runtime: TextLlmRuntime): TextLlmRuntimeInfo {
  if (isDevelopmentTextLlmRuntime(runtime)) {
    return {
      mode: runtime.mode,
      provider: runtime.provider,
      modelId: runtime.modelId,
      modelKey: runtime.modelKey,
      baseUrl: runtime.config.baseUrl,
      protocol: runtime.config.protocol,
    }
  }

  const model = runtime.requestedModel || ''
  return {
    mode: runtime.mode,
    provider: runtime.provider,
    modelId: model,
    modelKey: model,
  }
}

export function shouldUseDevelopmentTextLlm(): boolean {
  return isDevelopmentTextLlmRuntime(resolveTextLlmRuntime())
}
