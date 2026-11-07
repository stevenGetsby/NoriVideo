import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult } from '@/lib/generators/base'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import { getHuimengiModelDefinition } from './catalog'
import { asRecord, readFiniteNumber, readString, requestHuimengi } from './client'
import { formatHuimengiExternalId } from './external-id'
import type { HuimengiGenerateRequestOptions } from './types'

export interface HuimengiImageGenerateParams {
  userId: string
  prompt: string
  referenceImages?: string[]
  options: HuimengiGenerateRequestOptions
}

const IMAGE_RATIOS: Readonly<Record<string, readonly string[]>> = {
  'seedream-5.0-pro': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
  'seedream-5.0-lite': ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
  'qwen-image-3.0-pro': ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
  'qwen-image-3.0': ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
  'nb-2.1': ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '1:4', '4:1', '1:8', '8:1'],
}

const IMAGE_RESOLUTIONS: Readonly<Record<string, readonly string[]>> = {
  'seedream-5.0-pro': ['1K', '2K'],
  'seedream-5.0-lite': ['2K', '3K'],
  'qwen-image-3.0-pro': ['1k', '2k'],
  'qwen-image-3.0': ['1k', '2k'],
  'nb-2.1': ['1K', '2K', '4K'],
}

function integerOption(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = readFiniteNumber(value)
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`HUIMENGI_IMAGE_${field.toUpperCase()}_INVALID`)
  }
  return parsed
}

function resolveRatio(modelId: string, value: string): string | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  const candidate = normalized.toLowerCase() === 'auto' && modelId === 'nb-2.1' ? 'auto' : normalized
  const allowed = IMAGE_RATIOS[modelId] || []
  if (!allowed.includes(candidate)) {
    throw new Error(`HUIMENGI_IMAGE_RATIO_UNSUPPORTED: ${normalized}`)
  }
  return candidate
}

function resolveResolution(modelId: string, value: string, resolutionCase: 'lower' | 'upper'): string | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  const candidate = resolutionCase === 'upper' ? normalized.toUpperCase() : normalized.toLowerCase()
  const allowed = IMAGE_RESOLUTIONS[modelId] || []
  if (!allowed.includes(candidate)) {
    throw new Error(`HUIMENGI_IMAGE_RESOLUTION_UNSUPPORTED: ${normalized}`)
  }
  return candidate
}

export async function generateHuimengiImage(params: HuimengiImageGenerateParams): Promise<GenerateResult> {
  const model = getHuimengiModelDefinition(params.options.modelId, 'image')
  const prompt = params.prompt.trim()
  if (!prompt) throw new Error('HUIMENGI_IMAGE_PROMPT_REQUIRED')

  const referenceImages = await normalizeReferenceImagesForGeneration(params.referenceImages || [], {
    context: { provider: params.options.provider, modelId: model.modelId },
  })
  if (referenceImages.length > model.maxReferenceImages) {
    throw new Error(`HUIMENGI_IMAGE_REFERENCE_LIMIT: max ${model.maxReferenceImages} images`)
  }

  const options = params.options
  const ratio = resolveRatio(model.modelId, readString(options.aspectRatio) || readString(options.ratio))
  const resolution = resolveResolution(
    model.modelId,
    readString(options.resolution),
    model.resolutionCase,
  )
  const n = integerOption(options.n, 'n', 1, 6)
  const seed = integerOption(options.seed, 'seed', 0, 2_147_483_647)
  const outputFormat = readString(options.outputFormat).toLowerCase()
  const negativePrompt = readString(options.negativePrompt) || readString(options.negative_prompt)
  const promptExtend = options.promptExtend ?? options.prompt_extend
  const watermark = options.watermark

  const requestParams: Record<string, unknown> = {
    prompt,
    ...(referenceImages.length === 1 ? { image: referenceImages[0] } : {}),
    ...(referenceImages.length > 1 ? { image: referenceImages } : {}),
    ...(ratio ? { ratio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(typeof n === 'number' ? { n } : {}),
    ...(typeof seed === 'number' ? { seed } : {}),
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    ...(model.supportsOutputFormat && outputFormat ? { output_format: outputFormat === 'jpg' ? 'jpeg' : outputFormat } : {}),
    ...(typeof promptExtend === 'boolean' ? { prompt_extend: promptExtend } : {}),
    ...(typeof watermark === 'boolean' ? { watermark } : {}),
  }

  const config = await getProviderConfig(params.userId, options.provider)
  const payload = await requestHuimengi({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    path: '/api/v1/tasks',
    method: 'POST',
    body: { model: model.modelId, params: requestParams },
  })
  const record = asRecord(payload)
  const taskId = readString(record?.task_id) || readString(record?.id)
  if (!taskId) throw new Error('HUIMENGI_IMAGE_TASK_ID_MISSING')

  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: formatHuimengiExternalId({
      type: 'IMAGE',
      providerId: options.provider,
      modelId: model.modelId,
      taskId,
    }),
  }
}
