import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logProjectAction } from '@/lib/logging/semantic'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isArtStyleValue, isCustomArtStyleValue, parseCustomArtStyles, resolveCustomArtStylePrompt } from '@/lib/constants'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { extractModelKey } from '@/lib/config-service'
import {
  parseModelKeyStrict,
  type CapabilitySelections,
  type UnifiedModelType} from '@/lib/model-config-contract'
import {
  resolveBuiltinModelContext,
  getCapabilityOptionFields,
  validateCapabilitySelectionsPayload,
  type CapabilityModelContext} from '@/lib/model-capabilities/lookup'

const MODEL_FIELDS = [
  'analysisModel',
  'characterModel',
  'locationModel',
  'storyboardModel',
  'editModel',
  'videoModel',
  'audioModel',
] as const

const MODEL_FIELD_TO_TYPE: Record<typeof MODEL_FIELDS[number], UnifiedModelType> = {
  analysisModel: 'llm',
  characterModel: 'image',
  locationModel: 'image',
  storyboardModel: 'image',
  editModel: 'image',
  videoModel: 'video',
  audioModel: 'audio',
}

const CAPABILITY_MODEL_TYPES: readonly UnifiedModelType[] = ['image', 'video', 'llm', 'audio', 'lipsync']
const WORKFLOW_MODES = ['srt', 'agent'] as const
const USER_MODEL_DEFAULT_SELECT = {
  analysisModel: true,
  characterModel: true,
  locationModel: true,
  storyboardModel: true,
  editModel: true,
  videoModel: true,
  audioModel: true,
} as const

type ProjectModelFields = Record<typeof MODEL_FIELDS[number], string | null | undefined>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCapabilitySelectionsInput(
  raw: unknown,
  options?: { allowLegacyAspectRatio?: boolean },
): CapabilitySelections {
  if (raw === undefined || raw === null) return {}
  if (!isRecord(raw)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CAPABILITY_SELECTION_INVALID',
      field: 'capabilityOverrides'})
  }

  const normalized: CapabilitySelections = {}
  for (const [modelKey, rawSelection] of Object.entries(raw)) {
    if (!isRecord(rawSelection)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CAPABILITY_SELECTION_INVALID',
        field: `capabilityOverrides.${modelKey}`})
    }

    const selection: Record<string, string | number | boolean> = {}
    for (const [field, value] of Object.entries(rawSelection)) {
      if (field === 'aspectRatio') {
        if (options?.allowLegacyAspectRatio) continue
        throw new ApiError('INVALID_PARAMS', {
          code: 'CAPABILITY_FIELD_INVALID',
          field: `capabilityOverrides.${modelKey}.${field}`})
      }
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CAPABILITY_SELECTION_INVALID',
          field: `capabilityOverrides.${modelKey}.${field}`})
      }
      selection[field] = value
    }

    if (Object.keys(selection).length > 0) {
      normalized[modelKey] = selection
    }
  }

  return normalized
}

function parseStoredCapabilitySelections(raw: string | null | undefined): CapabilitySelections {
  if (!raw) return {}
  try {
    return normalizeCapabilitySelectionsInput(JSON.parse(raw) as unknown, { allowLegacyAspectRatio: true })
  } catch {
    return {}
  }
}

function serializeCapabilitySelections(selections: CapabilitySelections): string | null {
  if (Object.keys(selections).length === 0) return null
  return JSON.stringify(selections)
}

function validateModelKeyField(field: typeof MODEL_FIELDS[number], value: unknown) {
  // Contract anchor: model key must be provider::modelId
  if (value === null) return
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field})
  }
  if (!parseModelKeyStrict(value)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field})
  }
}

function validateArtStyleField(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ART_STYLE',
      field: 'artStyle',
      message: 'artStyle must be a supported value',
    })
  }
  const artStyle = value.trim()
  if (!isArtStyleValue(artStyle) && !isCustomArtStyleValue(artStyle)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_ART_STYLE',
      field: 'artStyle',
      message: 'artStyle must be a supported value',
    })
  }
  return artStyle
}

function validateWorkflowModeField(value: unknown): typeof WORKFLOW_MODES[number] {
  if (typeof value !== 'string' || !WORKFLOW_MODES.includes(value as typeof WORKFLOW_MODES[number])) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'WORKFLOW_MODE_INVALID',
      field: 'workflowMode',
      message: 'workflowMode must be srt or agent',
    })
  }
  return value as typeof WORKFLOW_MODES[number]
}

function resolveEffectiveModelFields(
  projectConfig: ProjectModelFields,
  userDefaults: ProjectModelFields | null | undefined,
): Record<typeof MODEL_FIELDS[number], string | null> {
  return {
    analysisModel: extractModelKey(projectConfig.analysisModel) || extractModelKey(userDefaults?.analysisModel) || null,
    characterModel: extractModelKey(projectConfig.characterModel) || extractModelKey(userDefaults?.characterModel) || null,
    locationModel: extractModelKey(projectConfig.locationModel) || extractModelKey(userDefaults?.locationModel) || null,
    storyboardModel: extractModelKey(projectConfig.storyboardModel) || extractModelKey(userDefaults?.storyboardModel) || null,
    editModel: extractModelKey(projectConfig.editModel) || extractModelKey(userDefaults?.editModel) || null,
    videoModel: extractModelKey(projectConfig.videoModel) || extractModelKey(userDefaults?.videoModel) || null,
    audioModel: extractModelKey(projectConfig.audioModel) || extractModelKey(userDefaults?.audioModel) || null,
  }
}

function getNextProjectModelMap(
  current: {
    analysisModel: string | null
    characterModel: string | null
    locationModel: string | null
    storyboardModel: string | null
    editModel: string | null
    videoModel: string | null
    audioModel: string | null
  },
  updates: Record<string, unknown>,
): Record<string, CapabilityModelContext> {
  const nextMap = new Map<string, CapabilityModelContext>()

  for (const field of MODEL_FIELDS) {
    const rawValue = updates[field] !== undefined
      ? updates[field]
      : current[field]
    if (typeof rawValue !== 'string' || !rawValue.trim()) continue

    const modelKey = rawValue.trim()
    const context = resolveBuiltinModelContext(MODEL_FIELD_TO_TYPE[field], modelKey)
    if (!context) continue
    nextMap.set(modelKey, context)
  }

  return Object.fromEntries(nextMap)
}

function resolveCapabilityContext(
  modelKey: string,
  modelContextMap: Record<string, CapabilityModelContext>,
): CapabilityModelContext | null {
  const fromProjectModel = modelContextMap[modelKey]
  if (fromProjectModel) return fromProjectModel
  if (!parseModelKeyStrict(modelKey)) return null

  for (const modelType of CAPABILITY_MODEL_TYPES) {
    const context = resolveBuiltinModelContext(modelType, modelKey)
    if (context) return context
  }

  return null
}

function sanitizeCapabilityOverrides(
  overrides: CapabilitySelections,
  modelContextMap: Record<string, CapabilityModelContext>,
): CapabilitySelections {
  const sanitized: CapabilitySelections = {}

  for (const [modelKey, selection] of Object.entries(overrides)) {
    const context = resolveCapabilityContext(modelKey, modelContextMap)
    if (!context) continue

    const optionFields = getCapabilityOptionFields(context.modelType, context.capabilities)
    if (Object.keys(optionFields).length === 0) continue

    const cleanedSelection: Record<string, string | number | boolean> = {}
    for (const [field, value] of Object.entries(selection)) {
      const allowedValues = optionFields[field]
      if (!allowedValues) continue
      if (!allowedValues.includes(value)) continue
      cleanedSelection[field] = value
    }

    if (Object.keys(cleanedSelection).length > 0) {
      sanitized[modelKey] = cleanedSelection
    }
  }

  return sanitized
}

function validateCapabilityOverrides(
  overrides: CapabilitySelections,
  modelContextMap: Record<string, CapabilityModelContext>,
) {
  const issues = validateCapabilitySelectionsPayload(overrides, (modelKey) =>
    resolveCapabilityContext(modelKey, modelContextMap))

  if (issues.length > 0) {
    const firstIssue = issues[0]
    throw new ApiError('INVALID_PARAMS', {
      code: firstIssue.code,
      field: firstIssue.field,
      allowedValues: firstIssue.allowedValues})
  }
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const projectData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: {
      capabilityOverrides: true,
      analysisModel: true,
      characterModel: true,
      locationModel: true,
      storyboardModel: true,
      editModel: true,
      videoModel: true,
      audioModel: true,
    }})
  const userPreference = await prisma.userPreference.findUnique({
    where: { userId: authResult.session.user.id },
    select: USER_MODEL_DEFAULT_SELECT,
  })

  const storedOverrides = parseStoredCapabilitySelections(projectData?.capabilityOverrides)
  const effectiveModelFields = projectData
    ? resolveEffectiveModelFields(projectData, userPreference)
    : null
  const modelContextMap = projectData
    ? getNextProjectModelMap(effectiveModelFields!, {})
    : {}
  const cleanedOverrides = sanitizeCapabilityOverrides(storedOverrides, modelContextMap)

  return NextResponse.json({
    capabilityOverrides: cleanedOverrides})
})

// PATCH - 更新小说推文项目配置
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session
  const project = authResult.project

  const body = await request.json()

  const currentProjectConfig = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: {
      analysisModel: true,
      characterModel: true,
      locationModel: true,
      storyboardModel: true,
      editModel: true,
      videoModel: true,
      audioModel: true,
    }})
  if (!currentProjectConfig) {
    throw new ApiError('NOT_FOUND')
  }
  const userPreference = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: USER_MODEL_DEFAULT_SELECT,
  })
  const effectiveCurrentProjectConfig = resolveEffectiveModelFields(currentProjectConfig, userPreference)

  const allowedProjectFields = [
    'analysisModel', 'characterModel', 'locationModel', 'storyboardModel',
    'editModel', 'videoModel', 'audioModel', 'videoRatio', 'videoResolution', 'artStyle', 'artStylePrompt',
    'ttsRate', 'lipSyncEnabled', 'lipSyncMode', 'capabilityOverrides', 'workflowMode',
    'projectLevel', 'projectStyle', 'targetAudience', 'targetEpisodeDurationSeconds',
  ] as const

  const updateData: Record<string, unknown> = {}
  for (const field of allowedProjectFields) {
    if (body[field] === undefined) continue

    if ((MODEL_FIELDS as readonly string[]).includes(field)) {
      validateModelKeyField(field as typeof MODEL_FIELDS[number], body[field])
    }

    if (field === 'artStyle') {
      const validatedArtStyle = validateArtStyleField(body[field])
      updateData[field] = validatedArtStyle

      // For custom styles, resolve the prompt text and save to artStylePrompt
      if (isCustomArtStyleValue(validatedArtStyle)) {
        const userPref = await prisma.userPreference.findUnique({
          where: { userId: session.user.id },
          select: { customArtStyles: true },
        })
        const customStyles = parseCustomArtStyles(userPref?.customArtStyles)
        const prompt = resolveCustomArtStylePrompt(validatedArtStyle, 'zh', customStyles)
        updateData['artStylePrompt'] = prompt || ''
      } else if (isArtStyleValue(validatedArtStyle)) {
        // Built-in style: clear artStylePrompt (will be resolved at runtime from constants)
        updateData['artStylePrompt'] = ''
      }
      continue
    }

    if (field === 'workflowMode') {
      updateData.workflowMode = validateWorkflowModeField(body[field])
      continue
    }

    if (field === 'projectLevel') {
      if (body[field] !== 'Nori1.0') {
        throw new ApiError('INVALID_PARAMS', {
          code: 'PROJECT_LEVEL_INVALID',
          field,
          message: 'projectLevel must be Nori1.0',
        })
      }
      updateData.projectLevel = 'Nori1.0'
      continue
    }

    if (field === 'projectStyle') {
      if (body[field] !== 'live-action' && body[field] !== 'anime') {
        throw new ApiError('INVALID_PARAMS', {
          code: 'PROJECT_STYLE_INVALID',
          field,
          message: 'projectStyle must be live-action or anime',
        })
      }
      updateData.projectStyle = body[field]
      continue
    }

    if (field === 'targetAudience') {
      if (body[field] !== 'zh-platform' && body[field] !== 'global-platform') {
        throw new ApiError('INVALID_PARAMS', {
          code: 'TARGET_AUDIENCE_INVALID',
          field,
          message: 'targetAudience must be zh-platform or global-platform',
        })
      }
      updateData.targetAudience = body[field]
      continue
    }

    if (field === 'targetEpisodeDurationSeconds') {
      const seconds = Number.parseInt(String(body[field]), 10)
      if (seconds !== 60 && seconds !== 90 && seconds !== 120) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'TARGET_EPISODE_DURATION_INVALID',
          field,
          message: 'targetEpisodeDurationSeconds must be 60, 90 or 120',
        })
      }
      updateData.targetEpisodeDurationSeconds = seconds
      continue
    }

    if (field === 'capabilityOverrides') {
      const overrides = normalizeCapabilitySelectionsInput(body.capabilityOverrides)
      const modelContextMap = getNextProjectModelMap(effectiveCurrentProjectConfig, body as Record<string, unknown>)
      const cleanedOverrides = sanitizeCapabilityOverrides(overrides, modelContextMap)
      validateCapabilityOverrides(cleanedOverrides, modelContextMap)
      updateData.capabilityOverrides = serializeCapabilitySelections(cleanedOverrides)
      continue
    }

    updateData[field] = body[field]
  }

  const updatedNovelPromotionData = await prisma.novelPromotionProject.update({
    where: { projectId },
    data: updateData})

  const novelPromotionDataWithSignedUrls = await attachMediaFieldsToProject(updatedNovelPromotionData)

  const fullProject = {
    ...project,
    novelPromotionData: novelPromotionDataWithSignedUrls}

  logProjectAction(
    'UPDATE_NOVEL_PROMOTION',
    session.user.id,
    session.user.name,
    projectId,
    project.name,
    JSON.stringify({ changes: body }),
  )

  return NextResponse.json({ project: fullProject })
})
