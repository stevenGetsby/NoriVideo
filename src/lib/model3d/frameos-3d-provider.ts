import { getServiceModel3DConfig } from '@/lib/service-config'

export const FRAMEOS_3D_MODEL_KEY = 'frameos3d::frameos-3d-v1'
export const FRAMEOS_3D_MODEL_NAME = '帧界 3D 1.0'

export type Frameos3DTopology = 'standard' | 'low_poly'
export type Frameos3DPose = 'none' | 'a_pose' | 't_pose'
export type Frameos3DProtocol = 'tripo-v2' | 'frameos-v1'

export type Frameos3DGenerationInput = {
  prompt: string
  topology: Frameos3DTopology
  generateTexture: boolean
  pose: Frameos3DPose
}

export type Frameos3DGenerationResult = {
  modelUrl: string
  thumbnailUrl: string | null
}

export type Frameos3DSubmission = {
  externalTaskId: string | null
  result: Frameos3DGenerationResult | null
}

export type Frameos3DProviderConfig = {
  protocol: Frameos3DProtocol
  baseUrl: string
  apiKey: string
  modelVersion: string
  createPath: string
  taskPath: string
  pollIntervalMs: number
  timeoutMs: number
}

type JsonRecord = Record<string, unknown>

const DEFAULT_TRIPO_BASE_URL = 'https://api.tripo3d.ai/v2/openapi'
const DEFAULT_MODEL_VERSION = 'v3.0-20250812'

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function configuredSecret(value: string): boolean {
  const lower = value.toLowerCase()
  return Boolean(value && value !== 'dummy' && !lower.startsWith('your-') && !lower.includes('replace-me'))
}

export function resolveFrameos3DProviderConfig(): Frameos3DProviderConfig | null {
  const file = getServiceModel3DConfig()?.frameos3d
  const apiKey = text(file?.apiKey) || text(process.env.FRAMEOS_3D_API_KEY) || text(process.env.TRIPO3D_API_KEY) || text(process.env.TRIPO_API_KEY)
  if (!configuredSecret(apiKey)) return null

  const protocol: Frameos3DProtocol = file?.protocol === 'frameos-v1' ? 'frameos-v1' : 'tripo-v2'
  const baseUrl = (text(file?.baseUrl) || text(process.env.FRAMEOS_3D_BASE_URL) || DEFAULT_TRIPO_BASE_URL).replace(/\/+$/, '')
  return {
    protocol,
    baseUrl,
    apiKey,
    modelVersion: text(file?.modelVersion) || text(process.env.FRAMEOS_3D_MODEL_VERSION) || DEFAULT_MODEL_VERSION,
    createPath: text(file?.createPath) || (protocol === 'frameos-v1' ? '/v1/model3d/generations' : '/task'),
    taskPath: text(file?.taskPath) || (protocol === 'frameos-v1' ? '/v1/model3d/generations/{taskId}' : '/task/{taskId}'),
    pollIntervalMs: boundedInteger(file?.pollIntervalMs ?? process.env.FRAMEOS_3D_POLL_INTERVAL_MS, 3_000, 500, 30_000),
    timeoutMs: boundedInteger(file?.timeoutMs ?? process.env.FRAMEOS_3D_TIMEOUT_MS, 20 * 60_000, 30_000, 60 * 60_000),
  }
}

export function getFrameos3DModelAvailability() {
  const available = Boolean(resolveFrameos3DProviderConfig())
  return {
    modelKey: FRAMEOS_3D_MODEL_KEY,
    name: FRAMEOS_3D_MODEL_NAME,
    provider: 'frameos3d',
    available,
    unavailableReason: available ? null : '请先配置帧界 3D 服务 API Key',
    options: {
      topology: ['standard', 'low_poly'],
      generateTexture: [true, false],
      pose: ['none', 'a_pose', 't_pose'],
    },
  }
}

export function normalizeFrameos3DTopology(value: unknown): Frameos3DTopology {
  return value === 'low_poly' ? 'low_poly' : 'standard'
}

export function normalizeFrameos3DPose(value: unknown): Frameos3DPose {
  return value === 'a_pose' || value === 't_pose' ? value : 'none'
}

export function compileFrameos3DPrompt(input: Frameos3DGenerationInput): string {
  const topology = input.topology === 'low_poly'
    ? 'Create clean low-poly topology with a deliberately reduced polygon count and a readable silhouette.'
    : 'Create production-ready standard topology with clean geometry and balanced detail.'
  const texture = input.generateTexture
    ? 'Generate complete UVs and physically based color textures.'
    : 'Return geometry only; do not generate color or PBR textures.'
  const pose = input.pose === 'a_pose'
    ? 'If the subject is a character, place it in a neutral symmetrical A-pose.'
    : input.pose === 't_pose'
      ? 'If the subject is a character, place it in a neutral symmetrical T-pose.'
      : 'Do not force an A-pose or T-pose; preserve the natural pose implied by the description.'
  return `${input.prompt.trim()}\n\n3D production requirements:\n- ${topology}\n- ${texture}\n- ${pose}`
}

function endpoint(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${baseUrl}/${path.replace(/^\/+/, '')}`
}

function responseMessage(payload: unknown, fallback: string): string {
  const root = record(payload)
  const data = record(root?.data)
  const error = record(root?.error) || record(data?.error)
  return text(error?.message)
    || text(root?.message)
    || text(data?.message)
    || fallback
}

function responseData(payload: unknown): JsonRecord {
  const root = record(payload) || {}
  return record(root.data) || root
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const source = record(value)
  return text(source?.url) || text(source?.href)
}

function firstUrl(records: JsonRecord[], keys: string[]): string {
  for (const source of records) {
    for (const key of keys) {
      const value = stringValue(source[key])
      if (value) return value
    }
  }
  return ''
}

function parseResult(payload: unknown): Frameos3DGenerationResult | null {
  const root = record(payload) || {}
  const data = responseData(payload)
  const output = record(data.output) || record(root.output) || {}
  const result = record(data.result) || record(root.result) || {}
  const records = [output, result, data, root]
  const modelUrl = firstUrl(records, ['pbr_model', 'model', 'model_url', 'modelUrl', 'base_model', 'url'])
  if (!modelUrl) return null
  return {
    modelUrl,
    thumbnailUrl: firstUrl(records, ['rendered_image', 'thumbnail', 'thumbnail_url', 'thumbnailUrl', 'preview_image', 'previewUrl']) || null,
  }
}

function parseTaskId(payload: unknown): string {
  const root = record(payload) || {}
  const data = responseData(payload)
  return text(data.task_id) || text(data.taskId) || text(data.id) || text(root.task_id) || text(root.taskId) || text(root.id)
}

function parseStatus(payload: unknown): string {
  const root = record(payload) || {}
  const data = responseData(payload)
  return (text(data.status) || text(data.state) || text(root.status) || text(root.state)).toLowerCase()
}

function parseProgress(payload: unknown): number {
  const root = record(payload) || {}
  const data = responseData(payload)
  const raw = Number(data.progress ?? data.percentage ?? root.progress ?? root.percentage)
  if (!Number.isFinite(raw)) return 0
  const normalized = raw > 0 && raw <= 1 ? raw * 100 : raw
  return Math.max(0, Math.min(100, Math.floor(normalized)))
}

async function requestJson(config: Frameos3DProviderConfig, url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 60_000))
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => null)
    const root = record(payload)
    const providerCode = Number(root?.code ?? 0)
    if (!response.ok || (Number.isFinite(providerCode) && providerCode !== 0)) {
      throw Object.assign(new Error(responseMessage(payload, `3D 服务请求失败 (${response.status})`)), {
        code: 'MODEL3D_PROVIDER_ERROR',
        retryable: response.status === 429 || response.status >= 500,
      })
    }
    return payload
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw Object.assign(new Error('3D 服务请求超时'), { code: 'MODEL3D_PROVIDER_TIMEOUT', retryable: true })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function createPayload(config: Frameos3DProviderConfig, input: Frameos3DGenerationInput) {
  const prompt = compileFrameos3DPrompt(input)
  if (config.protocol === 'frameos-v1') {
    return {
      model: FRAMEOS_3D_MODEL_KEY,
      prompt,
      topology: input.topology,
      generate_texture: input.generateTexture,
      pose: input.pose,
    }
  }
  return {
    type: 'text_to_model',
    prompt,
    model_version: config.modelVersion,
    texture: input.generateTexture,
    pbr: input.generateTexture,
  }
}

export async function submitFrameos3DGeneration(
  config: Frameos3DProviderConfig,
  input: Frameos3DGenerationInput,
): Promise<Frameos3DSubmission> {
  const payload = await requestJson(config, endpoint(config.baseUrl, config.createPath), {
    method: 'POST',
    body: JSON.stringify(createPayload(config, input)),
  })
  const result = parseResult(payload)
  const externalTaskId = parseTaskId(payload) || null
  if (!result && !externalTaskId) {
    throw Object.assign(new Error('3D 服务没有返回任务 ID 或模型地址'), {
      code: 'MODEL3D_PROVIDER_INVALID_RESPONSE',
      retryable: true,
    })
  }
  return { externalTaskId, result }
}

function taskUrl(config: Frameos3DProviderConfig, externalTaskId: string): string {
  const path = config.taskPath.replace('{taskId}', encodeURIComponent(externalTaskId))
  return endpoint(config.baseUrl, path)
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

export async function waitForFrameos3DGeneration(
  config: Frameos3DProviderConfig,
  externalTaskId: string,
  onProgress?: (progress: number, status: string) => void | Promise<void>,
): Promise<Frameos3DGenerationResult> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < config.timeoutMs) {
    const payload = await requestJson(config, taskUrl(config, externalTaskId))
    const status = parseStatus(payload)
    const progress = parseProgress(payload)
    await onProgress?.(progress, status)
    const result = parseResult(payload)
    if (result && (!status || ['success', 'succeeded', 'completed', 'complete', 'ready'].includes(status))) return result
    if (['failed', 'failure', 'error', 'canceled', 'cancelled', 'rejected'].includes(status)) {
      throw Object.assign(new Error(responseMessage(payload, '3D 模型生成失败')), {
        code: 'MODEL3D_GENERATION_FAILED',
        retryable: false,
      })
    }
    await wait(config.pollIntervalMs)
  }
  throw Object.assign(new Error('3D 模型生成超时，可稍后重试并继续恢复原任务'), {
    code: 'MODEL3D_GENERATION_TIMEOUT',
    retryable: true,
  })
}
