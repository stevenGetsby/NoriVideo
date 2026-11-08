import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { listNoriBusinessModels, resolveNoriModelRoute, type NoriBusinessModel } from '@/lib/nori-model-catalog'
import { parseModelKeyStrict, type CapabilityValue, type ModelCapabilities, type UnifiedModelType } from '@/lib/model-config-contract'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import { getPlatformServiceConfigResponse } from '@/lib/platform-services/config'
import { listConfiguredSelectableModels, type SelectableModelType } from '@/lib/platform-services/model-selection'
import type { VideoPricingTier } from '@/lib/model-pricing/video-tier'

interface UserModelOption {
  value: string
  label: string
  capabilities?: ModelCapabilities
  videoPricingTiers?: VideoPricingTier[]
}

function toOption(input: {
  value: string
  label: string
  provider: string
  modelId: string
  type: SelectableModelType | 'audio'
}): UserModelOption {
  const option: UserModelOption = { value: input.value, label: input.label }
  const capabilities = findBuiltinCapabilities(input.type, input.provider, input.modelId)
  if (capabilities) option.capabilities = capabilities
  if (input.type === 'video') {
    const pricing = findBuiltinPricingCatalogEntry('video', input.provider, input.modelId)
    if (pricing?.pricing.mode === 'capability' && Array.isArray(pricing.pricing.tiers)) {
      option.videoPricingTiers = pricing.pricing.tiers.map((tier) => ({
        when: { ...tier.when } as Record<string, CapabilityValue>,
      }))
    }
  }
  return option
}

function toConfiguredOptions(type: SelectableModelType) {
  return listConfiguredSelectableModels(getPlatformServiceConfigResponse(), type).map((model) => toOption({
    value: model.modelKey,
    label: model.modelId,
    provider: model.modelKey.split('::')[0],
    modelId: model.modelId,
    type,
  }))
}

function toAudioOption(model: NoriBusinessModel): UserModelOption {
  const target = parseModelKeyStrict(resolveNoriModelRoute(model.key) || '')
  return target
    ? toOption({ value: model.key, label: target.modelId, provider: target.provider, modelId: target.modelId, type: model.type as Extract<UnifiedModelType, 'audio'> })
    : { value: model.key, label: model.name }
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const llm = toConfiguredOptions('llm')
  const image = toConfiguredOptions('image')
  const video = toConfiguredOptions('video')
  const audio = listNoriBusinessModels('audio').map(toAudioOption)
  return NextResponse.json({ text: llm, llm, vision: [], image, video, audio, lipsync: [] })
})
