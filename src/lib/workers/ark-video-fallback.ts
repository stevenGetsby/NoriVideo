import type { Job } from 'bullmq'
import { getProviderConfig } from '@/lib/api-config'
import { arkCreateVideoTask } from '@/lib/ark-api'
import { resolveRuntimeModelKey } from '@/lib/nori-model-catalog'
import type { TaskJobData } from '@/lib/task/types'
import { waitExternalResult } from './utils'

type ArkFallbackOptions = {
  modelKey: string
  prompt: string
  resolution?: '480p' | '720p' | '1080p' | '4k'
  ratio?: string
  duration?: number
  generateAudio?: boolean
  seed?: number
  cameraFixed?: boolean
  watermark?: boolean
  progressStart?: number
  progressEnd?: number
  logPrefix?: string
}

export function isArkInputImageModerationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /InputImageSensitiveContentDetected|PrivacyInformation|输入图片审核未通过|input image/i.test(message)
}

export function isArkVideoModel(modelKey: string): boolean {
  const runtimeModelKey = resolveRuntimeModelKey(modelKey) || modelKey
  return /^ark::/i.test(runtimeModelKey) || /doubao-seedance/i.test(runtimeModelKey)
}

export function readArkModelId(modelKey: string): string {
  const runtimeModelKey = resolveRuntimeModelKey(modelKey) || modelKey
  return runtimeModelKey.startsWith('ark::') ? runtimeModelKey.slice('ark::'.length) : runtimeModelKey
}

export function buildArkTextOnlyFallbackPrompt(
  prompt: string,
  purpose: 'panel' | 'character-audition' = 'panel',
): string {
  if (purpose === 'character-audition') {
    return [
      '【重要】上游视频模型因真人隐私策略拒绝了角色参考图，当前改用纯文本生成虚构角色试镜视频。',
      '本任务的核心是获得可提取的角色对白音色：只保留一个说话角色，严格遵循原提示中的语言、台词、性别、年龄感、情绪、语速与声音质感。',
      '人声必须清晰、连续、近讲且无混响；背景音乐和环境声保持极弱，不得出现第二个人声，不得模仿或暗示任何真实人物身份。',
      prompt,
    ].join('\n')
  }
  return [
    '【重要】上游视频模型拒绝使用输入分镜图，为了继续完成 Agent 成片流程，改用纯文本视频生成。',
    '必须严格保持原 panel 的角色资产、服装、场景、道具、人物站位、镜头语言、按秒动作/对白和负面要求。',
    '不要新增无关角色，不要改变剧情，不要改变角色关系，不要改变地域/语言语境。',
    prompt,
  ].join('\n')
}

export async function submitArkTextOnlyVideoFallback(
  job: Job<TaskJobData>,
  options: ArkFallbackOptions,
) {
  const { apiKey } = await getProviderConfig(job.data.userId, 'ark')
  const fallbackTask = await arkCreateVideoTask({
    model: readArkModelId(options.modelKey),
    content: [{ type: 'text', text: options.prompt }],
    ...(options.resolution ? { resolution: options.resolution } : {}),
    ...(options.ratio ? { ratio: options.ratio } : {}),
    ...(typeof options.duration === 'number' ? { duration: options.duration } : {}),
    ...(typeof options.generateAudio === 'boolean' ? { generate_audio: options.generateAudio } : {}),
    ...(typeof options.seed === 'number' ? { seed: options.seed } : {}),
    ...(typeof options.cameraFixed === 'boolean' ? { camera_fixed: options.cameraFixed } : {}),
    ...(typeof options.watermark === 'boolean' ? { watermark: options.watermark } : {}),
  }, {
    apiKey,
    logPrefix: options.logPrefix || '[ARK Video Fallback]',
  })
  if (!fallbackTask.id) throw new Error('ARK text-only fallback did not return task id')
  return await waitExternalResult(job, `ARK:VIDEO:${fallbackTask.id}`, job.data.userId, {
    progressStart: options.progressStart ?? 45,
    progressEnd: options.progressEnd ?? 94,
  })
}
