import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth } from '@/lib/api-auth'
import { getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { resolveBuiltinCapabilitiesByModelKey, getCapabilityOptionFields } from '@/lib/model-capabilities/lookup'
import { listNoriBusinessModels, resolveNoriModelRoute } from '@/lib/nori-model-catalog'
import { listConfiguredSelectableModels } from '@/lib/platform-services/model-selection'
import { getFrameos3DModelAvailability } from '@/lib/model3d/frameos-3d-provider'
import { resolveCanvasGenerationInputSchema } from '@/lib/canvas/generation-input-schema'
import { audioDurationBounds } from '@/lib/audio/generation-contract'
import { resolveAudioGenerationAvailability } from '@/lib/audio/provider'
import { getPlatformServiceConfigResponse } from '@/lib/platform-services/config'
import { getLatestServiceHealth } from '@/lib/platform-services/health'
import { resolveConfiguredModelAvailability } from '@/lib/platform-services/model-availability'

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
  const textModels = listConfiguredSelectableModels(platformConfig, 'llm')
  const imageModels = listConfiguredSelectableModels(platformConfig, 'image')
  const videoModels = listConfiguredSelectableModels(platformConfig, 'video')

  function mapModels(type: 'llm' | 'image' | 'video', models: ReturnType<typeof listConfiguredSelectableModels>, defaultKey: string | null) {
    const unique = new Map(models.map((model) => [model.modelKey, model]))
    if (defaultKey?.startsWith('nori::') && !unique.has(defaultKey)) {
      const legacy = listNoriBusinessModels(type).find((model) => model.key === defaultKey)
      if (legacy) {
        const runtime = resolveNoriModelRoute(defaultKey)
        unique.set(defaultKey, {
          modelKey: legacy.key,
          modelId: runtime?.split('::')[1] || legacy.modelId,
          name: legacy.name,
          type,
        })
      }
    }
    return Array.from(unique.values()).map((model) => {
      const capabilities = resolveBuiltinCapabilitiesByModelKey(type, model.modelKey)
      const availability = resolveConfiguredModelAvailability({
        modelKey: model.modelKey,
        type,
        config: platformConfig,
        health: cachedHealth,
      })
      return {
        modelKey: model.modelKey,
        name: model.modelId,
        description: null,
        ...availability,
        options: getCapabilityOptionFields(type, capabilities),
        inputSchema: type === 'llm' ? null : resolveCanvasGenerationInputSchema(type, capabilities),
        supportsInpaint: type === 'image' ? capabilities?.image?.supportsInpaint === true : false,
        firstLastFrame: type === 'video' ? capabilities?.video?.firstlastframe === true : false,
        supportGenerateAudio: type === 'video' ? capabilities?.video?.supportGenerateAudio === true : false,
      }
    })
  }

  const audioModels = await Promise.all(listNoriBusinessModels('audio').filter((model) => model.key === 'nori::nori-audio').map(async (model) => {
    const capabilities = resolveBuiltinCapabilitiesByModelKey('audio', model.key)
    const availability = await resolveAudioGenerationAvailability({ userId: session.user.id, modelKey: model.key })
    const configuredAvailability = resolveConfiguredModelAvailability({
      modelKey: model.key,
      type: 'audio',
      config: platformConfig,
      health: cachedHealth,
    })
    const duration = audioDurationBounds(capabilities?.audio)
    return {
      modelKey: model.key,
      name: resolveNoriModelRoute(model.key)?.split('::')[1] || model.modelId,
      description: null,
      options: getCapabilityOptionFields('audio', capabilities),
      inputSchema: resolveCanvasGenerationInputSchema('audio', capabilities),
      audioModes: availability.modes,
      configured: configuredAvailability.configured,
      available: availability.available && configuredAvailability.available,
      unavailableReason: availability.unavailableReason || configuredAvailability.unavailableReason,
      runtimeModelKey: availability.runtimeModelKey || configuredAvailability.runtimeModelKey,
      healthStatus: configuredAvailability.healthStatus,
      healthMessage: configuredAvailability.healthMessage,
      healthCheckedAt: configuredAvailability.healthCheckedAt,
      minDurationSeconds: duration?.min || null,
      maxDurationSeconds: duration?.max || null,
      durationStepSeconds: duration?.step || null,
    }
  }))

  const model3dAvailability = getFrameos3DModelAvailability()
  return NextResponse.json({
    textModels: mapModels('llm', textModels, defaults.analysisModel),
    imageModels: mapModels('image', imageModels, defaults.characterModel || defaults.locationModel || defaults.editModel),
    videoModels: mapModels('video', videoModels, defaults.videoModel),
    audioModels,
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
      textModel: defaults.analysisModel,
      imageModel: defaults.characterModel || defaults.locationModel || defaults.editModel,
      editModel: defaults.editModel,
      storyboardModel: defaults.storyboardModel,
      videoModel: defaults.videoModel,
      audioModel: defaults.audioModel,
      model3dModel: model3dAvailability.modelKey,
      aspectRatio: 'videoRatio' in defaults ? defaults.videoRatio : '16:9',
      resolution: 'videoResolution' in defaults ? defaults.videoResolution : null,
    },
  })
})
