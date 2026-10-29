/**
 * 平台模型目录和用户默认模型偏好。用户无法写入 Provider 或 API 密钥。
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { composeModelKey, parseModelKeyStrict, type CapabilitySelections, type CapabilityValue } from '@/lib/model-config-contract'
import { resolveBuiltinModelContext, validateCapabilitySelectionsPayload } from '@/lib/model-capabilities/lookup'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { normalizeWorkflowConcurrencyConfig } from '@/lib/workflow-concurrency'
import { getPlatformServiceConfigResponse } from '@/lib/platform-services/config'

interface ApiConfigPutBody {
  models?: unknown
  providers?: unknown
  defaultModels?: unknown
  capabilityDefaults?: unknown
  workflowConcurrency?: unknown
}

const DEFAULT_MODEL_FIELDS = [
  'analysisModel', 'characterModel', 'locationModel', 'storyboardModel', 'editModel',
  'videoModel', 'audioModel',
] as const
type DefaultModelField = typeof DEFAULT_MODEL_FIELDS[number]
const MODEL_TYPES = { analysisModel: 'llm', characterModel: 'image', locationModel: 'image', storyboardModel: 'image', editModel: 'image', videoModel: 'video', audioModel: 'audio' } as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validateDefaultModelKey(value: unknown): string {
  const parsed = parseModelKeyStrict(typeof value === 'string' ? value : '')
  if (!parsed) throw new ApiError('INVALID_PARAMS', { code: 'MODEL_KEY_INVALID', message: 'must be provider::modelId' })
  return parsed.modelKey
}

function normalizeDefaults(input: unknown): Record<string, string> {
  if (input === undefined) return {}
  if (!isRecord(input)) throw new ApiError('INVALID_PARAMS', { field: 'defaultModels' })
  const output: Record<string, string> = {}
  for (const field of DEFAULT_MODEL_FIELDS) {
    if (input[field] === undefined) continue
    const parsed = parseModelKeyStrict(typeof input[field] === 'string' ? input[field] : '')
    if (!parsed) throw new ApiError('INVALID_PARAMS', { code: 'MODEL_KEY_INVALID', field: `defaultModels.${field}` })
    output[field] = validateDefaultModelKey(parsed.modelKey)
  }
  return output
}

function normalizeConcurrency(input: unknown) {
  if (input === undefined) return {}
  if (!isRecord(input)) throw new ApiError('INVALID_PARAMS', { field: 'workflowConcurrency' })
  const output: Record<string, number> = {}
  for (const field of ['analysis', 'image', 'video'] as const) {
    if (input[field] === undefined) continue
    if (!Number.isInteger(input[field]) || Number(input[field]) <= 0) throw new ApiError('INVALID_PARAMS', { field: `workflowConcurrency.${field}` })
    output[field] = Number(input[field])
  }
  return output
}

function normalizeCapabilities(input: unknown) {
  if (input === undefined) return undefined
  if (!isRecord(input)) throw new ApiError('INVALID_PARAMS', { field: 'capabilityDefaults' })
  const result: CapabilitySelections = {}
  for (const [modelKey, selection] of Object.entries(input)) {
    if (!isRecord(selection)) throw new ApiError('INVALID_PARAMS', { field: `capabilityDefaults.${modelKey}` })
    const clean: Record<string, CapabilityValue> = {}
    for (const [field, value] of Object.entries(selection)) {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new ApiError('INVALID_PARAMS', { field: `capabilityDefaults.${modelKey}.${field}` })
      clean[field] = value
    }
    if (Object.keys(clean).length) result[modelKey] = clean
  }
  return result
}

function storedCapabilities(input: string | null | undefined): CapabilitySelections {
  try { return normalizeCapabilities(input ? JSON.parse(input) : {}) || {} } catch { return {} }
}

export const GET = apiHandler(async () => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const pref = await prisma.userPreference.findUnique({ where: { userId: auth.session.user.id } })
  const config = getPlatformServiceConfigResponse()
  const defaultModels: Record<string, string> = {}
  const available = new Map(config.models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
  const legacyModels: Record<DefaultModelField, string> = { analysisModel: 'deepseek::deepseek-chat', characterModel: 'kuaizi::seedream5.0lite', locationModel: 'kuaizi::seedream5.0lite', storyboardModel: 'kuaizi::seedream5.0lite', editModel: 'kuaizi::seedream5.0lite', videoModel: 'kuaizi::doubao-seedance-2-0-260128', audioModel: 'kuaizi::speech-2.8-hd' }
  for (const field of DEFAULT_MODEL_FIELDS) {
    const stored = parseModelKeyStrict(typeof pref?.[field] === 'string' ? pref[field] : '')
    const fallback = parseModelKeyStrict(config.defaultModels[field as keyof typeof config.defaultModels] || legacyModels[field])
    const selected = stored && available.has(stored.modelKey) ? stored : fallback
    const model = selected ? available.get(selected.modelKey) : null
    defaultModels[field] = selected && model?.type === MODEL_TYPES[field] ? selected.modelKey : ''
  }
  return NextResponse.json({
    models: config.models.map((model) => ({ ...model, modelKey: composeModelKey(model.provider, model.modelId), enabled: true, price: 0, priceLabel: '--', capabilities: findBuiltinCapabilities(model.type, model.provider, model.modelId) })),
    providers: config.providers.map((provider) => ({ id: provider.id, name: provider.name, baseUrl: provider.baseUrl, hasApiKey: provider.hasApiKey })),
    defaultModels, capabilityDefaults: storedCapabilities(pref?.capabilityDefaults), pricingDisplay: {},
    workflowConcurrency: normalizeWorkflowConcurrencyConfig({ analysis: pref?.analysisConcurrency, image: pref?.imageConcurrency, video: pref?.videoConcurrency }),
  })
})

export const PUT = apiHandler(async (request: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  let body: ApiConfigPutBody
  try { body = await request.json() as ApiConfigPutBody } catch { throw new ApiError('INVALID_PARAMS', { field: 'body' }) }
  if (body.providers !== undefined || body.models !== undefined) throw new ApiError('FORBIDDEN', { message: '平台 API 与模型由管理员统一配置。' })
  const config = getPlatformServiceConfigResponse()
  const available = new Map(config.models.map((model) => [composeModelKey(model.provider, model.modelId), model]))
  const defaults = normalizeDefaults(body.defaultModels)
  const concurrency = normalizeConcurrency(body.workflowConcurrency)
  const capabilities = normalizeCapabilities(body.capabilityDefaults)
  const updateData: Record<string, unknown> = {}
  for (const [field, modelKey] of Object.entries(defaults)) {
    if (available.get(modelKey)?.type !== MODEL_TYPES[field as DefaultModelField]) throw new ApiError('INVALID_PARAMS', { field: `defaultModels.${field}`, message: '请选择平台已配置的对应类型模型。' })
    updateData[field] = modelKey
  }
  const concurrencyFields = { analysis: 'analysisConcurrency', image: 'imageConcurrency', video: 'videoConcurrency' } as const
  for (const [field, value] of Object.entries(concurrency)) updateData[concurrencyFields[field as keyof typeof concurrencyFields]] = value
  if (capabilities !== undefined) {
    const issues = validateCapabilitySelectionsPayload(capabilities, (modelKey) => {
      const model = available.get(modelKey)
      return model ? resolveBuiltinModelContext(model.type, modelKey) : null
    })
    if (issues.length) throw new ApiError('INVALID_PARAMS', { field: issues[0].field, message: issues[0].message })
    updateData.capabilityDefaults = Object.keys(capabilities).length ? JSON.stringify(capabilities) : null
  }
  await prisma.userPreference.upsert({ where: { userId: auth.session.user.id }, update: updateData, create: { userId: auth.session.user.id, ...updateData } })
  return NextResponse.json({ success: true })
})
