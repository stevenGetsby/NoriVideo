import { pollKuaiziTask } from './providers/kuaizi/poll'
import type { VideoResultMetadata } from './video-result'

export interface PollResult extends VideoResultMetadata {
  status: 'pending' | 'completed' | 'failed'
  resultUrl?: string
  imageUrl?: string
  videoUrl?: string
  audioUrl?: string
  actualVideoTokens?: number
  downloadHeaders?: Record<string, string>
  error?: string
}

export function parseExternalId(externalId: string): {
  provider: 'KUAIZI'
  type: 'VIDEO' | 'IMAGE' | 'AUDIO'
  endpoint?: string
  requestId: string
  providerToken: string
  modelKeyToken: string
} {
  const parts = externalId.split(':')
  const type = parts[1]
  const providerToken = parts[2]?.trim() || ''
  const modelKeyToken = parts[3]?.trim() || ''
  const requestId = parts.slice(4).join(':').trim()
  if (
    parts[0] !== 'KUAIZI'
    || (type !== 'VIDEO' && type !== 'IMAGE' && type !== 'AUDIO')
    || !providerToken || !modelKeyToken || !requestId
  ) {
    throw new Error('ASYNC_TASK_PROVIDER_RETIRED: 仅支持恢复 Kuaizi 图片、视频和音频任务')
  }
  return { provider: 'KUAIZI', type, providerToken, modelKeyToken, requestId }
}

export async function pollAsyncTask(externalId: string, userId: string): Promise<PollResult> {
  if (!userId) throw new Error('缺少用户ID，无法获取 API Key')
  const parsed = parseExternalId(externalId)
  return pollKuaiziTask({
    type: parsed.type,
    taskId: parsed.requestId,
    userId,
    providerToken: parsed.providerToken,
    modelToken: parsed.modelKeyToken,
  })
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
