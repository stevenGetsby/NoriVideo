import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { listNoriBusinessModels, resolveNoriModelRoute, type NoriBusinessModel } from '@/lib/nori-model-catalog'
import { parseModelKeyStrict, type CapabilityValue, type ModelCapabilities } from '@/lib/model-config-contract'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import { getPlatformServiceConfigResponse } from '@/lib/platform-services/config'
import {
  customerModelDisplayName,
  isInternalModelViewer,
  listSelectableModelsForViewer,
  providerModelDisplayName,
  viewerContextFromSession,
  type ModelViewerContext,
  type SelectableModelType,
} from '@/lib/platform-services/model-selection'
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

function toConfiguredOptions(type: SelectableModelType, viewer: ModelViewerContext) {
  const config = getPlatformServiceConfigResponse()
  const internalViewer = isInternalModelViewer(config, viewer)
  return listSelectableModelsForViewer(config, type, viewer).map((model) => {
    const runtime = parseModelKeyStrict(model.runtimeModelKey)
    const label = internalViewer
      ? providerModelDisplayName(model.runtimeModelKey, model.modelId)
      : customerModelDisplayName(model.modelKey, model.modelId)
    if (!runtime) return { value: model.modelKey, label }
    return toOption({
      value: model.modelKey,
      label,
      provider: runtime.provider,
      modelId: runtime.modelId,
      type,
    })
  })
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const viewer = viewerContextFromSession(authResult.session)

  const llm = toConfiguredOptions('llm', viewer)
  const image = toConfiguredOptions('image', viewer)
  const video = toConfiguredOptions('video', viewer)
  const audio = toConfiguredOptions('audio', viewer)
  void listNoriBusinessModels
  void resolveNoriModelRoute
  return NextResponse.json({ text: llm, llm, vision: [], image, video, audio, lipsync: [] })
})
