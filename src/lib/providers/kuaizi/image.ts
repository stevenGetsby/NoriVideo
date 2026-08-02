import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult } from '@/lib/generators/base'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import { getKuaiziModelDefinition } from './catalog'
import { asRecord, postKuaiziApiKey, readString } from './client'
import { formatKuaiziExternalId } from './external-id'
import type { KuaiziGenerateRequestOptions } from './types'

export interface KuaiziImageGenerateParams {
  userId: string
  prompt: string
  referenceImages?: string[]
  options: KuaiziGenerateRequestOptions
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeSeedreamSize(value: string): string {
  return /^(?:2k|3k)$/i.test(value) ? value.toLowerCase() : value
}

export function buildKuaiziImageRequest(input: {
  modelId: string
  family: 'gpt-image' | 'seedream'
  prompt: string
  referenceImages: string[]
  options: KuaiziGenerateRequestOptions
}): { path: string; body: Record<string, unknown> } {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('KUAIZI_IMAGE_PROMPT_REQUIRED')

  const sizeInput = readString(input.options.size) || readString(input.options.resolution)
  const aspectRatio = readString(input.options.aspectRatio)
  const outputFormat = readString(input.options.outputFormat).toLowerCase()
  const seed = optionalNumber(input.options.seed)

  if (input.family === 'gpt-image') {
    const explicitModelVersion = readString(input.options.modelVersion)
    const quality = readString(input.options.quality).toLowerCase()
    const modelVersion = explicitModelVersion || (
      quality === 'low' || quality === 'medium' || quality === 'high'
        ? `image2_${quality}`
        : ''
    )
    return {
      path: '/ai-open-platform-api/v1/chatgpt/image/task/create',
      body: {
        model: input.modelId,
        prompt,
        ...(readString(input.options.negativePrompt) ? { negative_prompt: readString(input.options.negativePrompt) } : {}),
        ...(input.referenceImages.length ? { images: input.referenceImages } : {}),
        ...(sizeInput ? { size: sizeInput } : {}),
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        ...(typeof seed === 'number' ? { seed } : {}),
        ...(modelVersion ? { model_version: modelVersion } : {}),
      },
    }
  }

  const maxImages = optionalNumber(input.options.maxImages)
  const optimizePrompt = input.options.optimizePrompt === true
  const sequentialImageGeneration = readString(input.options.sequentialImageGeneration)
  return {
    path: '/ai-open-platform-api/v1/seedream/image/task/create',
    body: {
      model: input.modelId,
      prompt,
      ...(input.referenceImages.length ? { image: input.referenceImages } : {}),
      ...(sizeInput ? { size: normalizeSeedreamSize(sizeInput) } : {}),
      ...(typeof seed === 'number' ? { seed } : {}),
      ...(typeof input.options.watermark === 'boolean' ? { watermark: input.options.watermark } : {}),
      ...(optimizePrompt ? {
        optimize_prompt: true,
        ...(readString(input.options.thinking)
          ? { optimize_prompt_options: { thinking: readString(input.options.thinking) } }
          : {}),
      } : {}),
      ...(sequentialImageGeneration ? { sequential_image_generation: sequentialImageGeneration } : {}),
      ...(typeof maxImages === 'number'
        ? { sequential_image_generation_options: { max_images: maxImages } }
        : {}),
      ...(outputFormat ? { output_format: outputFormat === 'jpg' ? 'jpeg' : outputFormat } : {}),
    },
  }
}

export async function generateKuaiziImage(params: KuaiziImageGenerateParams): Promise<GenerateResult> {
  const model = getKuaiziModelDefinition(params.options.modelId, 'image')
  if (model.family !== 'gpt-image' && model.family !== 'seedream') {
    throw new Error(`KUAIZI_IMAGE_MODEL_UNSUPPORTED: ${model.modelId}`)
  }
  const referenceImages = await normalizeReferenceImagesForGeneration(params.referenceImages || [], {
    context: { provider: params.options.provider, modelId: model.modelId },
  })
  const request = buildKuaiziImageRequest({
    modelId: model.modelId,
    family: model.family,
    prompt: params.prompt,
    referenceImages,
    options: params.options,
  })
  const config = await getProviderConfig(params.userId, params.options.provider)
  const payload = await postKuaiziApiKey({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    path: request.path,
    body: request.body,
  })
  const taskId = readString(asRecord(payload)?.task_id)
  if (!taskId) throw new Error('KUAIZI_IMAGE_TASK_ID_MISSING')
  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: formatKuaiziExternalId({
      type: 'IMAGE',
      providerId: params.options.provider,
      modelId: model.modelId,
      taskId,
    }),
  }
}
