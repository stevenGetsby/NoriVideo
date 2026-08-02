import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth } from '@/lib/api-auth'
import { getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { resolveBuiltinCapabilitiesByModelKey, getCapabilityOptionFields } from '@/lib/model-capabilities/lookup'
import { listNoriBusinessModels } from '@/lib/nori-model-catalog'
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
  const textModels = listNoriBusinessModels('llm').map((model) => ({
    modelKey: model.key,
    modelId: model.modelId,
    provider: 'nori',
    name: model.name,
    description: model.description,
    tier: model.tier,
    type: model.type,
  }))
  const imageModels = listNoriBusinessModels('image').map((model) => ({
    modelKey: model.key,
    modelId: model.modelId,
    provider: 'nori',
    name: model.name,
    description: model.description,
    tier: model.tier,
    type: model.type,
  }))
  const videoModels = listNoriBusinessModels('video').map((model) => ({
    modelKey: model.key,
    modelId: model.modelId,
    provider: 'nori',
    name: model.name,
    description: model.description,
    tier: model.tier,
    type: model.type,
  }))

  function mapModels(type: 'llm' | 'image' | 'video', models: Array<{
    modelKey: string
    modelId: string
    provider: string
    name: string
    type: string
    description?: string
    tier?: string
    price?: number
  }>, defaultKey: string | null) {
    const unique = new Map<string, {
      modelKey: string
      modelId: string
      provider: string
      name: string
      type: string
      description?: string
      tier?: string
      price?: number
    }>(models.map((model) => [model.modelKey, model]))
    if (defaultKey && !unique.has(defaultKey)) {
      unique.set(defaultKey, {
        modelKey: defaultKey,
        modelId: defaultKey.split('::').slice(1).join('::') || defaultKey,
        provider: defaultKey.split('::')[0] || 'default',
        name: defaultKey.split('::').slice(1).join('::') || defaultKey,
        type,
        price: 0,
      })
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
        name: model.name || model.modelId,
        provider: model.provider,
        description: model.description || null,
        tier: model.tier || 'standard',
        ...availability,
        options: getCapabilityOptionFields(type, capabilities),
        inputSchema: type === 'llm' ? null : resolveCanvasGenerationInputSchema(type, capabilities),
        supportsInpaint: type === 'image' ? capabilities?.image?.supportsInpaint === true : false,
        firstLastFrame: type === 'video' ? capabilities?.video?.firstlastframe === true : false,
        supportGenerateAudio: type === 'video' ? capabilities?.video?.supportGenerateAudio === true : false,
      }
    })
  }

  const audioModels = await Promise.all(listNoriBusinessModels('audio').map(async (model) => {
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
      name: model.name,
      provider: 'nori',
      description: model.description,
      tier: model.tier,
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
