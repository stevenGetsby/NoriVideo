import { getProviderConfig } from '@/lib/api-config'
import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'
import type { GenerateResult } from '@/lib/generators/base'
import {
  normalizeReferenceImagesForGeneration,
  normalizeToPublicImageUrlForGeneration,
} from '@/lib/media/outbound-image'
import { getOpenLuxModelDefinition } from './catalog'

export const OPENLUX_DEFAULT_BASE_URL = 'https://api.openlux.ai/v1'

const OPENLUX_DEFAULT_TIMEOUT_MS = 120_000
const OPENLUX_MAX_REFERENCE_IMAGES = 16
const OPENLUX_MAX_SOURCE_BYTES = 20 * 1024 * 1024
const OPENLUX_SOURCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
const OPENLUX_MAX_PROMPT_LENGTH = 1000
const OPENLUX_DOCUMENTED_SIZES = new Set([
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '2048x1152',
  '3840x2160',
  '2160x3840',
])
const OPENLUX_QUALITY_VALUES = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'auto'])
const OPENLUX_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp'])
const OPENLUX_RESPONSE_FORMATS = new Set(['url', 'b64_json'])
const OPENLUX_BACKGROUND_VALUES = new Set(['auto', 'opaque', 'transparent'])
const OPENLUX_MODERATION_VALUES = new Set(['auto', 'low'])

const ASPECT_RATIO_SIZES: Readonly<Record<string, string>> = {
  '1:1': '1024x1024',
  '16:9': '2048x1152',
  '9:16': '2160x3840',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '4:3': '1024x768',
  '3:4': '768x1024',
  '21:9': '2016x864',
}

type JsonRecord = Record<string, unknown>

export interface OpenLuxImageGenerateOptions extends JsonRecord {
  provider: string
  modelId: string
  modelKey?: string
}

export interface OpenLuxImageGenerateParams {
  userId: string
  prompt: string
  referenceImages?: string[]
  maskImage?: string
  editMode?: 'inpaint'
  options: OpenLuxImageGenerateOptions
}

export interface OpenLuxImageFields {
  prompt: string
  n: number
  size?: string
  quality?: string
  format?: string
  response_format: string
  background?: string
  moderation?: string
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readInteger(value: unknown): number | null {
  const parsed = readFiniteNumber(value)
  return parsed !== null && Number.isInteger(parsed) ? parsed : null
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

export function buildOpenLuxUrl(baseUrl: string | undefined, path: string): string {
  const base = (readString(baseUrl) || OPENLUX_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (base.endsWith('/v1') && normalizedPath.startsWith('/v1/')) {
    return `${base}${normalizedPath.slice('/v1'.length)}`
  }
  return `${base}${normalizedPath}`
}

function validateCustomSize(width: number, height: number): void {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width <= 0
    || height <= 0
    || width % 16 !== 0
    || height % 16 !== 0
  ) {
    throw new Error('OPENLUX_IMAGE_SIZE_INVALID: width and height must be positive multiples of 16')
  }
  if (width > 3840 || height > 3840) {
    throw new Error('OPENLUX_IMAGE_SIZE_INVALID: width and height must not exceed 3840')
  }
  const ratio = Math.max(width, height) / Math.min(width, height)
  if (ratio > 3) {
    throw new Error('OPENLUX_IMAGE_SIZE_INVALID: aspect ratio must not exceed 3:1')
  }
  const pixels = width * height
  if (pixels < 655_360 || pixels > 8_294_400) {
    throw new Error('OPENLUX_IMAGE_SIZE_INVALID: total pixels must be between 655360 and 8294400')
  }
}

function resolveSize(input: string): { size?: string } {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return {}
  if (OPENLUX_DOCUMENTED_SIZES.has(normalized)) return { size: normalized }

  const matched = /^(\d+)x(\d+)$/.exec(normalized)
  if (!matched) throw new Error(`OPENLUX_IMAGE_SIZE_UNSUPPORTED: ${input}`)
  const width = Number.parseInt(matched[1], 10)
  const height = Number.parseInt(matched[2], 10)
  validateCustomSize(width, height)
  return { size: `${width}x${height}` }
}

/**
 * Maps the platform's image options to OpenLux's documented request fields.
 * Unsupported explicit values fail before any paid request is submitted.
 */
export function buildOpenLuxImageFields(input: {
  prompt: string
  options?: Record<string, unknown>
}): OpenLuxImageFields {
  const prompt = readString(input.prompt)
  if (!prompt) throw new Error('OPENLUX_IMAGE_PROMPT_REQUIRED')
  if (prompt.length > OPENLUX_MAX_PROMPT_LENGTH) {
    throw new Error(`OPENLUX_IMAGE_PROMPT_TOO_LONG: max ${OPENLUX_MAX_PROMPT_LENGTH} characters`)
  }

  const options = input.options || {}
  const sizeInput = readString(options.size) || readString(options.resolution)
  const aspectRatio = readString(options.aspectRatio)
  const resolvedSize = sizeInput
    ? resolveSize(sizeInput)
    : resolveSize(ASPECT_RATIO_SIZES[aspectRatio] || 'auto')

  const n = options.n === undefined ? 1 : readInteger(options.n)
  if (n === null || n < 1 || n > 10) {
    throw new Error('OPENLUX_IMAGE_N_INVALID: n must be an integer between 1 and 10')
  }

  const quality = readString(options.quality).toLowerCase()
  if (quality && !OPENLUX_QUALITY_VALUES.has(quality)) {
    throw new Error(`OPENLUX_IMAGE_QUALITY_UNSUPPORTED: ${quality}`)
  }

  const outputFormatInput = readString(options.outputFormat).toLowerCase()
  const outputFormat = outputFormatInput === 'jpg' ? 'jpeg' : outputFormatInput
  if (outputFormat && !OPENLUX_OUTPUT_FORMATS.has(outputFormat)) {
    throw new Error(`OPENLUX_IMAGE_FORMAT_UNSUPPORTED: ${outputFormat}`)
  }

  const responseFormatInput = (
    readString(options.responseFormat)
    || readString(options.response_format)
    || 'url'
  ).toLowerCase()
  if (!OPENLUX_RESPONSE_FORMATS.has(responseFormatInput)) {
    throw new Error(`OPENLUX_IMAGE_RESPONSE_FORMAT_UNSUPPORTED: ${responseFormatInput}`)
  }

  const background = readString(options.background).toLowerCase()
  if (background === 'transparent' && outputFormat === 'jpeg') {
    throw new Error('OPENLUX_IMAGE_BACKGROUND_INVALID: transparent background requires png or webp')
  }
  if (background && !OPENLUX_BACKGROUND_VALUES.has(background)) {
    throw new Error(`OPENLUX_IMAGE_BACKGROUND_UNSUPPORTED: ${background}`)
  }

  const moderation = readString(options.moderation).toLowerCase()
  if (moderation && !OPENLUX_MODERATION_VALUES.has(moderation)) {
    throw new Error(`OPENLUX_IMAGE_MODERATION_UNSUPPORTED: ${moderation}`)
  }

  return {
    prompt,
    n,
    ...(resolvedSize.size ? { size: resolvedSize.size } : {}),
    ...(quality ? { quality } : {}),
    ...(outputFormat ? { format: outputFormat } : {}),
    response_format: responseFormatInput,
    ...(background ? { background } : {}),
    ...(moderation ? { moderation } : {}),
  }
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  return 'png'
}

async function readSourceBuffer(response: Response): Promise<Buffer> {
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > OPENLUX_MAX_SOURCE_BYTES) {
    await response.body?.cancel()
    throw new Error('OPENLUX_IMAGE_SOURCE_TOO_LARGE: source image exceeds 20MB')
  }
  if (!response.body) throw new Error('OPENLUX_IMAGE_SOURCE_EMPTY')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > OPENLUX_MAX_SOURCE_BYTES) {
        await reader.cancel()
        throw new Error('OPENLUX_IMAGE_SOURCE_TOO_LARGE: source image exceeds 20MB')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size)
}

async function fetchSourceBlob(source: string, timeoutMs: number): Promise<{ blob: Blob; extension: string }> {
  let response: Response
  try {
    response = await fetch(source, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    if (isTimeoutError(error)) throw new Error('OPENLUX_IMAGE_SOURCE_TIMEOUT')
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`OPENLUX_IMAGE_SOURCE_FETCH_FAILED: ${sanitizePublicError(message)}`)
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`OPENLUX_IMAGE_SOURCE_FETCH_FAILED: HTTP ${response.status}`)
  }
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || 'image/png'
  if (!OPENLUX_SOURCE_MIME_TYPES.has(contentType)) {
    await response.body?.cancel()
    throw new Error(`OPENLUX_IMAGE_SOURCE_TYPE_UNSUPPORTED: ${contentType}`)
  }
  const buffer = await readSourceBuffer(response)
  if (buffer.length === 0) throw new Error('OPENLUX_IMAGE_SOURCE_EMPTY')
  return {
    blob: new Blob([new Uint8Array(buffer)], { type: contentType }),
    extension: extensionForMimeType(contentType),
  }
}

function appendFields(form: FormData, fields: OpenLuxImageFields): void {
  form.append('prompt', fields.prompt)
  form.append('n', String(fields.n))
  form.append('response_format', fields.response_format)
  if (fields.size) form.append('size', fields.size)
  if (fields.quality) form.append('quality', fields.quality)
  if (fields.format) form.append('format', fields.format)
  if (fields.background) form.append('background', fields.background)
  if (fields.moderation) form.append('moderation', fields.moderation)
}

function responseMessage(payload: unknown, fallback: string): string {
  const record = asRecord(payload)
  if (!record) return fallback
  const nestedError = asRecord(record.error)
  return sanitizePublicError(
    readString(nestedError?.message)
    || readString(record.message)
    || readString(record.error)
    || fallback,
  )
}

function parseImageResult(payload: unknown): Omit<GenerateResult, 'success'> {
  const record = asRecord(payload)
  const data = record?.data
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('OPENLUX_IMAGE_RESULT_EMPTY')
  }

  const urls: string[] = []
  const base64Values: string[] = []
  for (const item of data) {
    const entry = asRecord(item)
    if (!entry) continue
    const url = readString(entry.url)
    if (url) urls.push(url)
    const base64 = readString(entry.b64_json)
    if (base64) base64Values.push(base64)
  }

  const dataUrls = base64Values.map((value) => `data:image/png;base64,${value}`)
  const allUrls = [...urls, ...dataUrls]
  if (allUrls.length === 0) throw new Error('OPENLUX_IMAGE_RESULT_EMPTY')

  const requestId = readString(record?.id) || readString(record?.request_id)
  return {
    ...(requestId ? { requestId } : {}),
    imageUrl: allUrls[0],
    ...(allUrls.length > 1 ? { imageUrls: allUrls } : {}),
    ...(base64Values.length > 0 ? { imageBase64: base64Values[0] } : {}),
  }
}

export async function generateOpenLuxImage(params: OpenLuxImageGenerateParams): Promise<GenerateResult> {
  const model = getOpenLuxModelDefinition(params.options.modelId, 'image')
  const timeoutMs = readInteger(params.options.timeoutMs) || OPENLUX_DEFAULT_TIMEOUT_MS

  const referenceImages = await normalizeReferenceImagesForGeneration(params.referenceImages || [], {
    context: { provider: params.options.provider, modelId: model.modelId },
  })
  if (referenceImages.length > OPENLUX_MAX_REFERENCE_IMAGES) {
    throw new Error(`OPENLUX_IMAGE_REFERENCE_LIMIT: max ${OPENLUX_MAX_REFERENCE_IMAGES} images`)
  }
  const maskImage = readString(params.maskImage)
  if (params.editMode === 'inpaint' && (!maskImage || referenceImages.length !== 1)) {
    throw new Error('OPENLUX_IMAGE_INPAINT_INVALID: inpainting requires one source image and a mask')
  }

  const fields = buildOpenLuxImageFields({ prompt: params.prompt, options: params.options })
  const config = await getProviderConfig(params.userId, params.options.provider)
  const isEdit = referenceImages.length > 0

  let requestBody: BodyInit
  const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}` }
  if (isEdit) {
    const form = new FormData()
    form.append('model', model.modelId)
    appendFields(form, fields)
    for (let index = 0; index < referenceImages.length; index += 1) {
      const source = await fetchSourceBlob(referenceImages[index], timeoutMs)
      form.append('image', source.blob, `image-${index}.${source.extension}`)
    }
    if (maskImage) {
      const normalizedMask = await normalizeToPublicImageUrlForGeneration(maskImage)
      const source = await fetchSourceBlob(normalizedMask, timeoutMs)
      form.append('mask', source.blob, `mask.${source.extension}`)
    }
    requestBody = form
  } else {
    headers['Content-Type'] = 'application/json'
    requestBody = JSON.stringify({ model: model.modelId, ...fields })
  }

  let response: Response
  try {
    response = await fetch(
      buildOpenLuxUrl(config.baseUrl, isEdit ? '/images/edits' : '/images/generations'),
      {
        method: 'POST',
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(timeoutMs),
      },
    )
  } catch (error) {
    if (isTimeoutError(error)) throw new Error('OPENLUX_IMAGE_TIMEOUT')
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`OPENLUX_IMAGE_NETWORK_ERROR: ${sanitizePublicError(message)}`)
  }

  const text = await response.text().catch(() => '')
  let payload: unknown = {}
  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      throw new Error(`OPENLUX_RESPONSE_INVALID_JSON: HTTP ${response.status}`)
    }
  }
  if (!response.ok) {
    throw new Error(`OPENLUX_HTTP_ERROR(${response.status}): ${responseMessage(payload, response.statusText || 'request failed')}`)
  }

  return { success: true, ...parseImageResult(payload) }
}
