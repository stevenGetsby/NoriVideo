import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth } from '@/lib/api-auth'
import { getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { resolveBuiltinCapabilitiesByModelKey, getCapabilityOptionFields } from '@/lib/model-capabilities/lookup'
import {
  customerModelDisplayName,
  isInternalModelViewer,
  listSelectableModelAliasesForViewer,
  listSelectableModelsForViewer,
  providerModelDisplayName,
  resolveSelectableModelKeyForViewer,
  viewerContextFromSession,
} from '@/lib/platform-services/model-selection'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { getFrameos3DModelAvailability } from '@/lib/model3d/frameos-3d-provider'
import { resolveCanvasGenerationInputSchema } from '@/lib/canvas/generation-input-schema'
import { audioDurationBounds } from '@/lib/audio/generation-contract'
import { resolveAudioGenerationAvailability } from '@/lib/audio/provider'
import { getPlatformServiceConfigResponse } from '@/lib/platform-services/config'
import { getLatestServiceHealth } from '@/lib/platform-services/health'
import { resolveConfiguredModelAvailability } from '@/lib/platform-services/model-availability'
import { sanitizePublicError } from '@/lib/errors/sanitize-public-error'

export const GET = apiHandler(async (request: NextRequest) => {
  const projectId = request.nextUrl.searchParams.get('projectId')?.trim() || ''
  const authResult = projectId
    ? await requireProjectAuthLight(projectId)
    : await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const [defaults, cachedHealth] = await Promise.all([
    projectId
      ? getProjectModelConfig(projectId, session.user.id)
      : getUserModelConfig(session.user.id),
    // Health checks are explicitly initiated from the admin console. Reading
    // their latest persisted result here is cheap and never calls a provider.
    getLatestServiceHealth().catch(() => []),
  ])
  const platformConfig = getPlatformServiceConfigResponse()
  const viewer = viewerContextFromSession(session)
  const internalViewer = isInternalModelViewer(platformConfig, viewer)
  const textModels = listSelectableModelsForViewer(platformConfig, 'llm', viewer)
  const imageModels = listSelectableModelsForViewer(platformConfig, 'image', viewer)
  const videoModels = listSelectableModelsForViewer(platformConfig, 'video', viewer)

  function mapModels(type: 'llm' | 'image' | 'video', models: ReturnType<typeof listSelectableModelsForViewer>) {
    return models.map((model) => {
      const capabilities = resolveBuiltinCapabilitiesByModelKey(type, model.runtimeModelKey || model.modelKey)
      const availability = resolveConfiguredModelAvailability({
        modelKey: model.modelKey,
        type,
        config: platformConfig,
        health: cachedHealth,
        redactProviderNames: !internalViewer,
        viewer,
      })
      const { runtimeModelKey, ...publicAvailability } = availability
      return {
        modelKey: model.modelKey,
        name: internalViewer
          ? providerModelDisplayName(model.runtimeModelKey, model.modelId)
          : customerModelDisplayName(model.modelKey, model.modelId),
        description: null,
        ...publicAvailability,
        ...(internalViewer ? { runtimeModelKey } : {}),
        options: getCapabilityOptionFields(type, capabilities),
        inputSchema: type === 'llm' ? null : resolveCanvasGenerationInputSchema(type, capabilities),
        supportsInpaint: type === 'image' ? capabilities?.image?.supportsInpaint === true : false,
        firstLastFrame: type === 'video' ? capabilities?.video?.firstlastframe === true : false,
        supportGenerateAudio: type === 'video' ? capabilities?.video?.supportGenerateAudio === true : false,
      }
    })
  }

  const audioModels = await Promise.all(listSelectableModelsForViewer(platformConfig, 'audio', viewer).filter((model) => model.modelKey === 'nori::nori-audio').map(async (model) => {
    const capabilities = resolveBuiltinCapabilitiesByModelKey('audio', model.runtimeModelKey || model.modelKey)
    const availability = await resolveAudioGenerationAvailability({ userId: session.user.id, modelKey: model.modelKey, viewer })
    const configuredAvailability = resolveConfiguredModelAvailability({
      modelKey: model.modelKey,
      type: 'audio',
      config: platformConfig,
      health: cachedHealth,
      redactProviderNames: !internalViewer,
      viewer,
    })
    const duration = audioDurationBounds(capabilities?.audio)
    const resolvedRuntimeKey = availability.runtimeModelKey || configuredAvailability.runtimeModelKey || model.runtimeModelKey
    const usesReferenceAudio = parseModelKeyStrict(resolvedRuntimeKey || '')?.modelId === 'seed-audio'
    const rawAudioUnavailableReason = availability.unavailableReason || configuredAvailability.unavailableReason
    const audioUnavailableReason = rawAudioUnavailableReason && !internalViewer
      ? sanitizePublicError(rawAudioUnavailableReason)
      : rawAudioUnavailableReason
    return {
      modelKey: model.modelKey,
      name: internalViewer
        ? providerModelDisplayName(model.runtimeModelKey, model.modelId)
        : customerModelDisplayName(model.modelKey, model.modelId),
      description: null,
      options: getCapabilityOptionFields('audio', capabilities),
      inputSchema: resolveCanvasGenerationInputSchema('audio', capabilities),
      audioModes: availability.modes,
      usesReferenceAudio,
      configured: configuredAvailability.configured,
      available: availability.available && configuredAvailability.available,
      unavailableReason: audioUnavailableReason,
      ...(internalViewer ? { runtimeModelKey: resolvedRuntimeKey } : {}),
      healthStatus: configuredAvailability.healthStatus,
      healthMessage: configuredAvailability.healthMessage,
      healthCheckedAt: configuredAvailability.healthCheckedAt,
      minDurationSeconds: duration?.min || null,
      maxDurationSeconds: duration?.max || null,
      durationStepSeconds: duration?.step || null,
    }
  }))

  const model3dAvailability = getFrameos3DModelAvailability()
  const rawImageDefault = defaults.characterModel || defaults.locationModel || defaults.editModel || ''
  return NextResponse.json({
    modelViewMode: internalViewer ? 'internal' : 'customer',
    textModels: mapModels('llm', textModels),
    imageModels: mapModels('image', imageModels),
    videoModels: mapModels('video', videoModels),
    audioModels,
    modelAliases: listSelectableModelAliasesForViewer(platformConfig, viewer),
    model3dModels: [{
      ...model3dAvailability,
      description: '3D 模型生成',
      tier: 'standard',
      configured: model3dAvailability.available,
      healthStatus: 'unknown',
      healthMessage: model3dAvailability.available ? '当前 3D 适配器未提供独立健康检测。' : null,
      healthCheckedAt: null,
    }],
    defaults: {
      textModel: resolveSelectableModelKeyForViewer(platformConfig, defaults.analysisModel || '', 'llm', viewer) || defaults.analysisModel,
      imageModel: resolveSelectableModelKeyForViewer(platformConfig, rawImageDefault, 'image', viewer) || rawImageDefault,
      editModel: resolveSelectableModelKeyForViewer(platformConfig, defaults.editModel || '', 'image', viewer) || defaults.editModel,
      storyboardModel: resolveSelectableModelKeyForViewer(platformConfig, defaults.storyboardModel || '', 'image', viewer) || defaults.storyboardModel,
      videoModel: resolveSelectableModelKeyForViewer(platformConfig, defaults.videoModel || '', 'video', viewer),
      audioModel: resolveSelectableModelKeyForViewer(platformConfig, defaults.audioModel || '', 'audio', viewer) || defaults.audioModel,
      model3dModel: model3dAvailability.modelKey,
      aspectRatio: 'videoRatio' in defaults ? defaults.videoRatio : '16:9',
      resolution: 'videoResolution' in defaults ? defaults.videoResolution : null,
    },
  })
})
