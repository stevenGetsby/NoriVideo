import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logProjectAction } from '@/lib/logging/semantic'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { requireProjectReader } from '@/lib/collaboration/access'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { validateVideoExportTemplate } from '@/lib/novel-promotion/video-export-name'
import { isArtStyleValue, isCustomArtStyleValue, parseCustomArtStyles, resolveCustomArtStylePrompt } from '@/lib/constants'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { extractModelKey, getProjectModelConfig } from '@/lib/config-service'
import {
  parseModelKeyStrict,
  type CapabilitySelections,
  type UnifiedModelType} from '@/lib/model-config-contract'
import {
  resolveBuiltinModelContext,
  getCapabilityOptionFields,
  validateCapabilitySelectionsPayload,
  type CapabilityModelContext} from '@/lib/model-capabilities/lookup'
import { findNoriBusinessModel } from '@/lib/nori-model-catalog'
import {
  type ProjectStyle,
  EPISODE_DURATION_MODES,
  PROJECT_STYLES,
  TARGET_AUDIENCES,
  VIDEO_RATIOS,
  VIDEO_RESOLUTIONS,
  CREATE_PROJECT_STYLE_PROMPT_MAX_LENGTH,
  buildUnifiedArtStylePrompt,
  PROJECT_LEVELS,
} from '@/lib/projects/creation-config'

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

const PROJECT_SETTING_ENUMS = {
  projectStyle: PROJECT_STYLES,
  targetAudience: TARGET_AUDIENCES,
  videoRatio: VIDEO_RATIOS,
  videoResolution: VIDEO_RESOLUTIONS,
} as const

type ProjectSettingEnumField = keyof typeof PROJECT_SETTING_ENUMS
type ProjectSettingEnumValue = (typeof PROJECT_SETTING_ENUMS)[ProjectSettingEnumField][number]

const CUSTOM_ART_STYLE_MARKER = '【用户自定义画风（最高优先级）】'

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
  const expectedType = MODEL_FIELD_TO_TYPE[field]
  if (expectedType === 'llm' || expectedType === 'image' || expectedType === 'video') {
    const businessModel = findNoriBusinessModel(value)
    if (!businessModel || businessModel.type !== expectedType) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MODEL_NOT_PLATFORM_MANAGED',
        field,
        message: `${field} must use a Nori business model`,
      })
    }
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

function validateProjectSettingEnum(field: ProjectSettingEnumField, value: unknown): ProjectSettingEnumValue {
  const allowed = PROJECT_SETTING_ENUMS[field]
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ApiError('INVALID_PARAMS', {
      code: `${field.replace(/([A-Z])/g, '_$1').toUpperCase()}_INVALID`,
      field,
      allowedValues: [...allowed],
      message: `${field} must be one of: ${allowed.join(', ')}`,
    })
  }
  return value as ProjectSettingEnumValue
}

function editableArtStylePrompt(value: string | null | undefined): string {
  if (!value) return ''
  const markerIndex = value.indexOf(CUSTOM_ART_STYLE_MARKER)
  if (markerIndex < 0) return ''
  const start = markerIndex + CUSTOM_ART_STYLE_MARKER.length
  const rest = value.slice(start)
  const nextSection = rest.indexOf('\n\n【')
  const custom = (nextSection >= 0 ? rest.slice(0, nextSection) : rest).trim()
  return custom
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
      projectStyle: true,
      targetAudience: true,
      videoRatio: true,
      videoResolution: true,
      episodeDurationMode: true,
      episodeDurationValue: true,
      artStylePrompt: true,
      exportNamingTemplate: true,
      exportDirectoryHint: true,
    }})
  const storedOverrides = parseStoredCapabilitySelections(projectData?.capabilityOverrides)
  const projectModelConfig = projectData
    ? await getProjectModelConfig(projectId, authResult.session.user.id)
    : null
  const effectiveModelFields = projectModelConfig
    ? {
      analysisModel: projectModelConfig.analysisModel,
      characterModel: projectModelConfig.characterModel,
      locationModel: projectModelConfig.locationModel,
      storyboardModel: projectModelConfig.storyboardModel,
      editModel: projectModelConfig.editModel,
      videoModel: projectModelConfig.videoModel,
      audioModel: projectModelConfig.audioModel,
    }
    : null
  const modelContextMap = projectData
    ? getNextProjectModelMap(effectiveModelFields!, {})
    : {}
  const cleanedOverrides = sanitizeCapabilityOverrides(storedOverrides, modelContextMap)

  return NextResponse.json({
    capabilityOverrides: cleanedOverrides,
    modelConfig: effectiveModelFields,
    projectStyle: projectData?.projectStyle,
    targetAudience: projectData?.targetAudience,
    videoRatio: projectData?.videoRatio,
    videoResolution: projectData?.videoResolution,
    episodeDurationMode: projectData?.episodeDurationMode,
    episodeDurationValue: projectData?.episodeDurationValue,
    artStylePrompt: editableArtStylePrompt(projectData?.artStylePrompt),
    exportNamingTemplate: projectData?.exportNamingTemplate || null,
    exportDirectoryHint: projectData?.exportDirectoryHint || null,
  })
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

  await requireProjectReader(session, projectId)

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
      projectStyle: true,
      artStylePrompt: true,
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
    'projectLevel', 'projectStyle', 'targetAudience', 'episodeDurationMode',
    'episodeDurationValue', 'targetEpisodeDurationSeconds',
    'exportNamingTemplate', 'exportDirectoryHint',
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
      if (!(PROJECT_LEVELS as readonly unknown[]).includes(body[field])) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'PROJECT_LEVEL_INVALID',
          field,
          message: `projectLevel must be one of: ${PROJECT_LEVELS.join(', ')}`,
        })
      }
      updateData.projectLevel = body[field]
      continue
    }

    if (field === 'projectStyle') {
      updateData.projectStyle = validateProjectSettingEnum('projectStyle', body[field])
      continue
    }

    if (field === 'targetAudience') {
      updateData.targetAudience = validateProjectSettingEnum('targetAudience', body[field])
      continue
    }

    if (field === 'videoRatio') {
      updateData.videoRatio = validateProjectSettingEnum('videoRatio', body[field])
      continue
    }

    if (field === 'videoResolution') {
      updateData.videoResolution = validateProjectSettingEnum('videoResolution', body[field])
      continue
    }

    if (field === 'episodeDurationMode') {
      if (!(EPISODE_DURATION_MODES as readonly unknown[]).includes(body[field])) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'EPISODE_DURATION_MODE_INVALID',
          field,
          message: `episodeDurationMode must be one of: ${EPISODE_DURATION_MODES.join(', ')}`,
        })
      }
      updateData.episodeDurationMode = body[field]
      continue
    }

    if (field === 'episodeDurationValue' || field === 'targetEpisodeDurationSeconds') {
      const seconds = Number.parseInt(String(body[field]), 10)
      const mode = body.episodeDurationMode === 'per-1000-chars' ? 'per-1000-chars' : 'per-episode'
      const minimum = mode === 'per-episode' ? 10 : 1
      const maximum = mode === 'per-episode' ? 3600 : 600
      if (!Number.isInteger(seconds) || seconds < minimum || seconds > maximum) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'TARGET_EPISODE_DURATION_INVALID',
          field,
          message: `${field} must be an integer between ${minimum} and ${maximum}`,
        })
      }
      updateData.episodeDurationValue = seconds
      updateData.targetEpisodeDurationSeconds = seconds
      continue
    }

    if (field === 'artStylePrompt') {
      if (typeof body[field] !== 'string') {
        throw new ApiError('INVALID_PARAMS', {
          code: 'FIELD_TYPE_INVALID',
          field,
          message: 'artStylePrompt must be a string',
        })
      }
      const customPrompt = body[field].trim()
      if (customPrompt.length > CREATE_PROJECT_STYLE_PROMPT_MAX_LENGTH) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'FIELD_TOO_LONG',
          field,
          limit: CREATE_PROJECT_STYLE_PROMPT_MAX_LENGTH,
          message: `${field} is too long`,
        })
      }
      const nextProjectStyle = validateProjectSettingEnum(
        'projectStyle',
        body.projectStyle ?? currentProjectConfig.projectStyle,
      )
      updateData.artStylePrompt = buildUnifiedArtStylePrompt({
        projectStyle: nextProjectStyle as ProjectStyle,
        referenceArtStylePrompt: null,
        customArtStylePrompt: customPrompt || null,
      })
      continue
    }

    if (field === 'exportNamingTemplate') {
      if (typeof body[field] !== 'string' || body[field].length > 191) {
        throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, message: 'exportNamingTemplate must be a string up to 191 characters' })
      }
      if (!validateVideoExportTemplate(body[field].trim())) throw new ApiError('INVALID_PARAMS', { message: '导出命名规则不能包含路径或未知占位符。' })
      updateData.exportNamingTemplate = body[field].trim() || null
      continue
    }

    if (field === 'exportDirectoryHint') {
      if (typeof body[field] !== 'string' || body[field].length > 500) {
        throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, message: 'exportDirectoryHint must be a string up to 500 characters' })
      }
      updateData.exportDirectoryHint = body[field].trim() || null
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
