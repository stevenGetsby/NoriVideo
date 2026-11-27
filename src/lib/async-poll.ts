import { pollHuimengiTask } from './providers/huimengi/poll'
import type { HuimengiAsyncType } from './providers/huimengi/external-id'
import { pollKuaiziTask } from './providers/kuaizi/poll'
import type { KuaiziAsyncType } from './providers/kuaizi/external-id'
import { pollAilinkTask } from './providers/ailink/poll'
import { pollTopenrouterTask } from './providers/topenrouter/poll'
import type { VideoResultMetadata } from './video-result'

export interface PollResult extends VideoResultMetadata {
  status: 'pending' | 'completed' | 'failed'
  resultUrl?: string
  imageUrl?: string
  imageUrls?: string[]
  videoUrl?: string
  audioUrl?: string
  actualVideoTokens?: number
  downloadHeaders?: Record<string, string>
  error?: string
}

interface BaseParsedExternalId {
  endpoint?: string
  requestId: string
  providerToken: string
  modelKeyToken: string
}

export type ParsedExternalId =
  | (BaseParsedExternalId & { provider: 'KUAIZI'; type: KuaiziAsyncType })
  | (BaseParsedExternalId & { provider: 'HUIMENGI'; type: HuimengiAsyncType })
  | (BaseParsedExternalId & { provider: 'AILINK'; type: 'VIDEO' })
  | (BaseParsedExternalId & { provider: 'TOPENROUTER'; type: 'VIDEO' })

const RETIRED_MESSAGE = 'ASYNC_TASK_PROVIDER_RETIRED: 仅支持恢复 Kuaizi、绘梦工坊、AILink 和 TopenRouter 的图片、视频任务'

export function parseExternalId(externalId: string): ParsedExternalId {
  const parts = externalId.split(':')
  const namespace = parts[0]
  const type = parts[1]
  const providerToken = parts[2]?.trim() || ''
  const modelKeyToken = parts[3]?.trim() || ''
  const requestId = parts.slice(4).join(':').trim()
  if (namespace === 'KUAIZI') {
    if ((type !== 'VIDEO' && type !== 'IMAGE' && type !== 'AUDIO') || !providerToken || !modelKeyToken || !requestId) {
      throw new Error(RETIRED_MESSAGE)
    }
    return { provider: 'KUAIZI', type, providerToken, modelKeyToken, requestId }
  }
  if (namespace === 'HUIMENGI') {
    if ((type !== 'VIDEO' && type !== 'IMAGE') || !providerToken || !modelKeyToken || !requestId) {
      throw new Error(RETIRED_MESSAGE)
    }
    return { provider: 'HUIMENGI', type, providerToken, modelKeyToken, requestId }
  }
  if (namespace === 'AILINK') {
    if (type !== 'VIDEO' || !providerToken || !modelKeyToken || !requestId) {
      throw new Error(RETIRED_MESSAGE)
    }
    return { provider: 'AILINK', type, providerToken, modelKeyToken, requestId }
  }
  if (namespace === 'TOPENROUTER') {
    if (type !== 'VIDEO' || !providerToken || !modelKeyToken || !requestId) {
      throw new Error(RETIRED_MESSAGE)
    }
    return { provider: 'TOPENROUTER', type, providerToken, modelKeyToken, requestId }
  }
  throw new Error(RETIRED_MESSAGE)
}

export async function pollAsyncTask(externalId: string, userId: string, signal?: AbortSignal): Promise<PollResult> {
  if (!userId) throw new Error('缺少用户ID，无法获取 API Key')
  const parsed = parseExternalId(externalId)
  if (parsed.provider === 'HUIMENGI') {
    return pollHuimengiTask({
      type: parsed.type,
      taskId: parsed.requestId,
      userId,
      providerToken: parsed.providerToken,
      modelToken: parsed.modelKeyToken,
      signal,
    })
  }
  if (parsed.provider === 'TOPENROUTER') {
    return pollTopenrouterTask({
      taskId: parsed.requestId,
      userId,
      providerToken: parsed.providerToken,
      modelToken: parsed.modelKeyToken,
      signal,
    })
  }
  if (parsed.provider === 'AILINK') {
    return pollAilinkTask({
      taskId: parsed.requestId,
      userId,
      providerToken: parsed.providerToken,
      modelToken: parsed.modelKeyToken,
      signal,
    })
  }
  return pollKuaiziTask({
    type: parsed.type,
    taskId: parsed.requestId,
    userId,
    providerToken: parsed.providerToken,
    modelToken: parsed.modelKeyToken,
    signal,
  })
}

// Billing must charge the provider that actually executed the task, not the
// route configured later. The pinned provider/model tokens inside externalId
// are the only trustworthy source for in-flight tasks.
export function resolveExecutedModelKeyFromExternalId(externalId: string | null | undefined): string | null {
  if (!externalId) return null
  try {
    const parsed = parseExternalId(externalId)
    const provider = Buffer.from(parsed.providerToken, 'base64url').toString('utf8').trim()
    const modelId = Buffer.from(parsed.modelKeyToken, 'base64url').toString('utf8').trim()
    return provider && modelId ? `${provider}::${modelId}` : null
  } catch {
    return null
  }
}

export function formatExternalId(
  provider: 'KUAIZI',
  type: 'VIDEO' | 'IMAGE' | 'AUDIO',
  requestId: string,
  endpoint?: string,
  providerToken?: string,
  modelKeyToken?: string,
): string {
  if (provider !== 'KUAIZI' || !providerToken || !modelKeyToken) {
    throw new Error('ASYNC_TASK_PROVIDER_RETIRED: 仅支持 Kuaizi 任务')
  }
  return `KUAIZI:${type}:${providerToken}:${modelKeyToken}:${requestId}`
}
