export type UnifiedModelType = 'llm' | 'image' | 'video' | 'audio' | 'lipsync'
export type CapabilityValue = string | number | boolean
export type CapabilityOptionValue = CapabilityValue
export type CapabilitySelections = Record<string, Record<string, CapabilityValue>>

export type CapabilityValidationCode =
  | 'CAPABILITY_SHAPE_INVALID'
  | 'CAPABILITY_NAMESPACE_INVALID'
  | 'CAPABILITY_FIELD_INVALID'
  | 'CAPABILITY_VALUE_NOT_ALLOWED'

export interface CapabilityValidationIssue {
  code: CapabilityValidationCode
  field: string
  message: string
  allowedValues?: readonly CapabilityOptionValue[]
}

export interface CapabilityFieldI18n {
  labelKey?: string
  unitKey?: string
  optionLabelKeys?: Record<string, string>
}

export type CapabilityFieldI18nMap = Record<string, CapabilityFieldI18n>

export interface CapabilityMediaInputLimit {
  min?: number
  max?: number
  maxTotalDurationSeconds?: number
}

/**
 * Provider input contract used by creative surfaces before a paid task is
 * submitted. It intentionally lives beside model capabilities so the client
 * and the API do not maintain two independent sets of reference limits.
 */
export interface CapabilityInputSchema {
  image?: CapabilityMediaInputLimit
  video?: CapabilityMediaInputLimit
  audio?: CapabilityMediaInputLimit
  requiredFields?: string[]
}

export interface LLMCapabilities {
  reasoningEffortOptions?: string[]
  fieldI18n?: CapabilityFieldI18nMap
}

export interface ImageCapabilities {
  resolutionOptions?: string[]
  /** The provider exposes a real mask-aware image edit endpoint. */
  supportsInpaint?: boolean
  inputSchema?: CapabilityInputSchema
  fieldI18n?: CapabilityFieldI18nMap
}

export interface VideoCapabilities {
  generationModeOptions?: string[]
  generateAudioOptions?: boolean[]
  durationOptions?: number[]
  fpsOptions?: number[]
  resolutionOptions?: string[]
  firstlastframe?: boolean
  supportGenerateAudio?: boolean
  inputSchema?: CapabilityInputSchema
  fieldI18n?: CapabilityFieldI18nMap
}

export interface AudioCapabilities {
  /** Explicit generation modes implemented by this exact provider model. */
  modeOptions?: Array<'music' | 'tts' | 'sfx'>
  voiceOptions?: string[]
  rateOptions?: string[]
  /** Optional enumerated durations. Continuous ranges use the bounds below. */
  durationOptions?: number[]
  minDurationSeconds?: number
  maxDurationSeconds?: number
  durationStepSeconds?: number
  inputSchema?: CapabilityInputSchema
  fieldI18n?: CapabilityFieldI18nMap
}

export interface LipSyncCapabilities {
  modeOptions?: string[]
  fieldI18n?: CapabilityFieldI18nMap
}

export interface ModelCapabilities {
  llm?: LLMCapabilities
  image?: ImageCapabilities
  video?: VideoCapabilities
  audio?: AudioCapabilities
  lipsync?: LipSyncCapabilities
}

export interface ParsedModelKey {
  provider: string
  modelId: string
  modelKey: string
}

const CAPABILITY_NAMESPACES = new Set<keyof ModelCapabilities>([
  'llm',
  'image',
  'video',
  'audio',
  'lipsync',
])

const LLM_ALLOWED_FIELDS = new Set<keyof LLMCapabilities>([
  'reasoningEffortOptions',
  'fieldI18n',
])

const IMAGE_ALLOWED_FIELDS = new Set<keyof ImageCapabilities>([
  'resolutionOptions',
  'supportsInpaint',
  'inputSchema',
  'fieldI18n',
])

const VIDEO_ALLOWED_FIELDS = new Set<keyof VideoCapabilities>([
  'generationModeOptions',
  'generateAudioOptions',
  'durationOptions',
  'fpsOptions',
  'resolutionOptions',
  'firstlastframe',
  'supportGenerateAudio',
  'inputSchema',
  'fieldI18n',
])

const AUDIO_ALLOWED_FIELDS = new Set<keyof AudioCapabilities>([
  'modeOptions',
  'voiceOptions',
  'rateOptions',
  'durationOptions',
  'minDurationSeconds',
  'maxDurationSeconds',
  'durationStepSeconds',
  'inputSchema',
  'fieldI18n',
])

const LIPSYNC_ALLOWED_FIELDS = new Set<keyof LipSyncCapabilities>([
  'modeOptions',
  'fieldI18n',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0)
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

function isBooleanArray(value: unknown): value is boolean[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'boolean')
}

function makeAllowedIssue(
  field: string,
  value: unknown,
  allowedValues: readonly CapabilityOptionValue[],
): CapabilityValidationIssue {
  return {
    code: 'CAPABILITY_VALUE_NOT_ALLOWED',
    field,
    allowedValues,
    message: `Value ${String(value)} is not allowed`,
  }
}

function validateFieldI18nMap(
  issues: CapabilityValidationIssue[],
  namespace: keyof ModelCapabilities,
  rawFieldI18n: unknown,
  allowedFields: Readonly<Record<string, readonly CapabilityOptionValue[] | undefined>>,
) {
  if (rawFieldI18n === undefined) return
  if (!isRecord(rawFieldI18n)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: `capabilities.${namespace}.fieldI18n`,
      message: 'fieldI18n must be an object',
    })
    return
  }

  for (const [field, rawConfig] of Object.entries(rawFieldI18n)) {
    if (!(field in allowedFields)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.${namespace}.fieldI18n.${field}`,
        message: `Unknown i18n field: ${field}`,
      })
      continue
    }

    if (!isRecord(rawConfig)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.${namespace}.fieldI18n.${field}`,
        message: 'field i18n config must be an object',
      })
      continue
    }

    if (rawConfig.labelKey !== undefined && !isNonEmptyString(rawConfig.labelKey)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.${namespace}.fieldI18n.${field}.labelKey`,
        message: 'labelKey must be a non-empty string',
      })
    }

    if (rawConfig.unitKey !== undefined && !isNonEmptyString(rawConfig.unitKey)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `capabilities.${namespace}.fieldI18n.${field}.unitKey`,
        message: 'unitKey must be a non-empty string',
      })
    }

    if (rawConfig.optionLabelKeys !== undefined) {
      if (!isRecord(rawConfig.optionLabelKeys)) {
        issues.push({
          code: 'CAPABILITY_FIELD_INVALID',
          field: `capabilities.${namespace}.fieldI18n.${field}.optionLabelKeys`,
          message: 'optionLabelKeys must be an object',
        })
        continue
      }

      const allowedOptionKeys = new Set((allowedFields[field] || []).map((value) => String(value)))
      for (const [optionKey, optionLabel] of Object.entries(rawConfig.optionLabelKeys)) {
        if (!isNonEmptyString(optionLabel)) {
          issues.push({
            code: 'CAPABILITY_FIELD_INVALID',
            field: `capabilities.${namespace}.fieldI18n.${field}.optionLabelKeys.${optionKey}`,
            message: 'option label must be a non-empty string',
          })
        }
        if (allowedOptionKeys.size > 0 && !allowedOptionKeys.has(optionKey)) {
          issues.push({
            code: 'CAPABILITY_VALUE_NOT_ALLOWED',
            field: `capabilities.${namespace}.fieldI18n.${field}.optionLabelKeys.${optionKey}`,
            message: `Option key ${optionKey} is not defined in ${field}Options`,
            allowedValues: Array.from(allowedOptionKeys),
          })
        }
      }
    }
  }
}

function validateNamespaceShape(
  issues: CapabilityValidationIssue[],
  namespace: keyof ModelCapabilities,
  value: unknown,
) {
  if (value === undefined) return
  if (!isRecord(value)) {
    issues.push({
      code: 'CAPABILITY_SHAPE_INVALID',
      field: `capabilities.${namespace}`,
      message: `capabilities.${namespace} must be an object`,
    })
  }
}

function validateNamespaceAllowedFields(
  issues: CapabilityValidationIssue[],
  namespace: keyof ModelCapabilities,
  value: unknown,
  allowedFields: ReadonlySet<string>,
) {
  if (!isRecord(value)) return
  for (const field of Object.keys(value)) {
    if (allowedFields.has(field)) continue
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: `capabilities.${namespace}.${field}`,
      message: field === 'i18n'
        ? 'Use fieldI18n instead of i18n'
        : `Unknown capability field: ${field}`,
    })
  }
}

function validateLLMCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return
  const options = raw.reasoningEffortOptions
  if (options !== undefined && !isStringArray(options)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.llm.reasoningEffortOptions',
      message: 'reasoningEffortOptions must be a non-empty string array',
    })
  }

  validateFieldI18nMap(issues, 'llm', raw.fieldI18n, {
    reasoningEffort: isStringArray(options) ? options : undefined,
  })
}

function validateCapabilityInputSchema(
  issues: CapabilityValidationIssue[],
  namespace: 'image' | 'video' | 'audio',
  value: unknown,
) {
  if (value === undefined) return
  const field = `capabilities.${namespace}.inputSchema`
  if (!isRecord(value)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field,
      message: 'inputSchema must be an object',
    })
    return
  }

  const allowed = new Set(['image', 'video', 'audio', 'requiredFields'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `${field}.${key}`,
        message: `Unknown input schema field: ${key}`,
      })
    }
  }

  if (value.requiredFields !== undefined && !isStringArray(value.requiredFields)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: `${field}.requiredFields`,
      message: 'requiredFields must be a non-empty string array',
    })
  }

  for (const mediaType of ['image', 'video', 'audio'] as const) {
    const limit = value[mediaType]
    if (limit === undefined) continue
    if (!isRecord(limit)) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `${field}.${mediaType}`,
        message: 'media input limit must be an object',
      })
      continue
    }
    for (const key of Object.keys(limit)) {
      if (key !== 'min' && key !== 'max' && key !== 'maxTotalDurationSeconds') {
        issues.push({
          code: 'CAPABILITY_FIELD_INVALID',
          field: `${field}.${mediaType}.${key}`,
          message: `Unknown media input limit: ${key}`,
        })
      }
    }
    for (const key of ['min', 'max', 'maxTotalDurationSeconds'] as const) {
      const raw = limit[key]
      if (raw === undefined) continue
      const valid = typeof raw === 'number'
        && Number.isFinite(raw)
        && raw >= 0
        && (key === 'maxTotalDurationSeconds' || Number.isInteger(raw))
      if (!valid) {
        issues.push({
          code: 'CAPABILITY_FIELD_INVALID',
          field: `${field}.${mediaType}.${key}`,
          message: key === 'maxTotalDurationSeconds'
            ? 'duration limit must be a finite non-negative number'
            : 'reference limit must be a non-negative integer',
        })
      }
    }
    if (
      typeof limit.min === 'number'
      && typeof limit.max === 'number'
      && limit.min > limit.max
    ) {
      issues.push({
        code: 'CAPABILITY_FIELD_INVALID',
        field: `${field}.${mediaType}`,
        message: 'media input min cannot be greater than max',
      })
    }
  }
}

function validateImageCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return

  const resolutionOptions = raw.resolutionOptions
  if (resolutionOptions !== undefined && !isStringArray(resolutionOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.image.resolutionOptions',
      message: 'resolutionOptions must be a non-empty string array',
    })
  }

  if (raw.supportsInpaint !== undefined && typeof raw.supportsInpaint !== 'boolean') {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.image.supportsInpaint',
      message: 'supportsInpaint must be boolean',
    })
  }

  validateCapabilityInputSchema(issues, 'image', raw.inputSchema)

  validateFieldI18nMap(issues, 'image', raw.fieldI18n, {
    resolution: isStringArray(resolutionOptions) ? resolutionOptions : undefined,
  })
}

function validateVideoCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return

  const generationModeOptions = raw.generationModeOptions
  if (generationModeOptions !== undefined && !isStringArray(generationModeOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.generationModeOptions',
      message: 'generationModeOptions must be a non-empty string array',
    })
  }

  const generateAudioOptions = raw.generateAudioOptions
  if (generateAudioOptions !== undefined && !isBooleanArray(generateAudioOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.generateAudioOptions',
      message: 'generateAudioOptions must be a boolean array',
    })
  }

  const durationOptions = raw.durationOptions
  if (durationOptions !== undefined && !isNumberArray(durationOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.durationOptions',
      message: 'durationOptions must be a finite number array',
    })
  }

  const fpsOptions = raw.fpsOptions
  if (fpsOptions !== undefined && !isNumberArray(fpsOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.fpsOptions',
      message: 'fpsOptions must be a finite number array',
    })
  }

  const resolutionOptions = raw.resolutionOptions
  if (resolutionOptions !== undefined && !isStringArray(resolutionOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.resolutionOptions',
      message: 'resolutionOptions must be a non-empty string array',
    })
  }

  if (raw.supportGenerateAudio !== undefined && typeof raw.supportGenerateAudio !== 'boolean') {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.supportGenerateAudio',
      message: 'supportGenerateAudio must be boolean',
    })
  }

  if (raw.firstlastframe !== undefined && typeof raw.firstlastframe !== 'boolean') {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.firstlastframe',
      message: 'firstlastframe must be boolean',
    })
  }

  validateCapabilityInputSchema(issues, 'video', raw.inputSchema)

  validateFieldI18nMap(issues, 'video', raw.fieldI18n, {
    generationMode: isStringArray(generationModeOptions) ? generationModeOptions : undefined,
    generateAudio: isBooleanArray(generateAudioOptions) ? generateAudioOptions : undefined,
    duration: isNumberArray(durationOptions) ? durationOptions : undefined,
    fps: isNumberArray(fpsOptions) ? fpsOptions : undefined,
    resolution: isStringArray(resolutionOptions) ? resolutionOptions : undefined,
  })
}

function validateAudioCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return

  const modeOptions = raw.modeOptions
  const allowedModes = ['music', 'tts', 'sfx'] as const
  if (modeOptions !== undefined && (
    !isStringArray(modeOptions)
    || modeOptions.some((mode) => !allowedModes.includes(mode as typeof allowedModes[number]))
  )) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.audio.modeOptions',
      message: 'modeOptions must only contain music/tts/sfx',
      allowedValues: allowedModes,
    })
  }

  const voiceOptions = raw.voiceOptions
  if (voiceOptions !== undefined && !isStringArray(voiceOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.audio.voiceOptions',
      message: 'voiceOptions must be a non-empty string array',
    })
  }

  const rateOptions = raw.rateOptions
  if (rateOptions !== undefined && !isStringArray(rateOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.audio.rateOptions',
      message: 'rateOptions must be a non-empty string array',
    })
  }

  const durationOptions = raw.durationOptions
  if (durationOptions !== undefined && !isNumberArray(durationOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.audio.durationOptions',
      message: 'durationOptions must be a finite number array',
    })
  }

  const minDurationSeconds = raw.minDurationSeconds
  const maxDurationSeconds = raw.maxDurationSeconds
  const durationStepSeconds = raw.durationStepSeconds
  if (minDurationSeconds !== undefined && (
    typeof minDurationSeconds !== 'number'
    || !Number.isFinite(minDurationSeconds)
    || minDurationSeconds <= 0
  )) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.audio.minDurationSeconds',
      message: 'minDurationSeconds must be a finite number greater than 0',
    })
  }
  if (maxDurationSeconds !== undefined && (
    typeof maxDurationSeconds !== 'number'
    || !Number.isFinite(maxDurationSeconds)
    || maxDurationSeconds <= 0
  )) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.audio.maxDurationSeconds',
      message: 'maxDurationSeconds must be a finite number greater than 0',
    })
  }
  if (durationStepSeconds !== undefined && (
    typeof durationStepSeconds !== 'number'
    || !Number.isFinite(durationStepSeconds)
    || durationStepSeconds <= 0
  )) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.audio.durationStepSeconds',
      message: 'durationStepSeconds must be a finite number greater than 0',
    })
  }
  if (
    typeof minDurationSeconds === 'number'
    && Number.isFinite(minDurationSeconds)
    && typeof maxDurationSeconds === 'number'
    && Number.isFinite(maxDurationSeconds)
    && minDurationSeconds > maxDurationSeconds
  ) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.audio.maxDurationSeconds',
      message: 'maxDurationSeconds must be greater than or equal to minDurationSeconds',
    })
  }

  validateCapabilityInputSchema(issues, 'audio', raw.inputSchema)

  validateFieldI18nMap(issues, 'audio', raw.fieldI18n, {
    mode: isStringArray(modeOptions) ? modeOptions : undefined,
    voice: isStringArray(voiceOptions) ? voiceOptions : undefined,
    rate: isStringArray(rateOptions) ? rateOptions : undefined,
    duration: isNumberArray(durationOptions) ? durationOptions : undefined,
  })
}

function validateLipSyncCapabilities(issues: CapabilityValidationIssue[], raw: unknown) {
  if (!isRecord(raw)) return
  const modeOptions = raw.modeOptions
  if (modeOptions !== undefined && !isStringArray(modeOptions)) {
    issues.push({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.lipsync.modeOptions',
      message: 'modeOptions must be a non-empty string array',
    })
  }

  validateFieldI18nMap(issues, 'lipsync', raw.fieldI18n, {
    mode: isStringArray(modeOptions) ? modeOptions : undefined,
  })
}

function validateOptionFieldValue(
  fieldPath: string,
  value: unknown,
  allowedValues: readonly CapabilityOptionValue[],
): CapabilityValidationIssue | null {
  if (!allowedValues.includes(value as CapabilityOptionValue)) {
    return makeAllowedIssue(fieldPath, value, allowedValues)
  }
  return null
}

export function validateOptionValueAgainstAllowed(
  fieldPath: string,
  value: unknown,
  allowedValues: readonly CapabilityOptionValue[],
): CapabilityValidationIssue[] {
  const issue = validateOptionFieldValue(fieldPath, value, allowedValues)
  return issue ? [issue] : []
}

export function composeModelKey(provider: string, modelId: string): string {
  const providerValue = provider.trim()
  const modelValue = modelId.trim()
  if (!providerValue || !modelValue) return ''
  return `${providerValue}::${modelValue}`
}

export function parseModelKeyStrict(key: string | null | undefined): ParsedModelKey | null {
  if (!key || typeof key !== 'string') return null
  const raw = key.trim()
  if (!raw) return null
  const markerIndex = raw.indexOf('::')
  if (markerIndex === -1) return null
  const provider = raw.slice(0, markerIndex).trim()
  const modelId = raw.slice(markerIndex + 2).trim()
  if (!provider || !modelId) return null
  return {
    provider,
    modelId,
    modelKey: `${provider}::${modelId}`,
  }
}

export function isModelKey(value: string | null | undefined): boolean {
  return !!parseModelKeyStrict(value)
}

export function validateModelCapabilities(
  modelType: UnifiedModelType,
  capabilities: unknown,
): CapabilityValidationIssue[] {
  const issues: CapabilityValidationIssue[] = []
  const expectedNamespace: keyof ModelCapabilities = modelType

  if (capabilities === undefined || capabilities === null) return issues
  if (!isRecord(capabilities)) {
    issues.push({
      code: 'CAPABILITY_SHAPE_INVALID',
      field: 'capabilities',
      message: 'capabilities must be an object',
    })
    return issues
  }

  for (const namespace of Object.keys(capabilities)) {
    if (!CAPABILITY_NAMESPACES.has(namespace as keyof ModelCapabilities)) {
      issues.push({
        code: 'CAPABILITY_NAMESPACE_INVALID',
        field: `capabilities.${namespace}`,
        message: `Unknown capabilities namespace: ${namespace}`,
      })
      continue
    }

    if (namespace !== expectedNamespace) {
      issues.push({
        code: 'CAPABILITY_NAMESPACE_INVALID',
        field: `capabilities.${namespace}`,
        allowedValues: [expectedNamespace],
        message: `Namespace ${namespace} is not allowed for model type ${modelType}`,
      })
    }
  }

  validateNamespaceShape(issues, 'llm', capabilities.llm)
  validateNamespaceShape(issues, 'image', capabilities.image)
  validateNamespaceShape(issues, 'video', capabilities.video)
  validateNamespaceShape(issues, 'audio', capabilities.audio)
  validateNamespaceShape(issues, 'lipsync', capabilities.lipsync)

  validateNamespaceAllowedFields(issues, 'llm', capabilities.llm, LLM_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'image', capabilities.image, IMAGE_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'video', capabilities.video, VIDEO_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'audio', capabilities.audio, AUDIO_ALLOWED_FIELDS)
  validateNamespaceAllowedFields(issues, 'lipsync', capabilities.lipsync, LIPSYNC_ALLOWED_FIELDS)

  validateLLMCapabilities(issues, capabilities.llm)
  validateImageCapabilities(issues, capabilities.image)
  validateVideoCapabilities(issues, capabilities.video)
  validateAudioCapabilities(issues, capabilities.audio)
  validateLipSyncCapabilities(issues, capabilities.lipsync)

  return issues
}
