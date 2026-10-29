import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import {
  listNoriBusinessModels,
  resolveNoriModelRoute,
  type NoriBusinessModel,
  type NoriModelTier,
} from '@/lib/nori-model-catalog'
import { parseModelKeyStrict, type CapabilityValue, type ModelCapabilities } from '@/lib/model-config-contract'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import type { VideoPricingTier } from '@/lib/model-pricing/video-tier'

interface UserModelOption {
  value: string
  label: string
  provider: 'nori'
  providerName: 'LanmiaoTV'
  tier: NoriModelTier
  capabilities?: ModelCapabilities
  videoPricingTiers?: VideoPricingTier[]
}

interface UserModelsPayload {
  text: UserModelOption[]
  llm: UserModelOption[]
  vision: UserModelOption[]
  image: UserModelOption[]
  video: UserModelOption[]
  audio: UserModelOption[]
  lipsync: UserModelOption[]
}

function cloneVideoPricingTiers(rawTiers: Array<{ when: Record<string, CapabilityValue> }>): VideoPricingTier[] {
  return rawTiers.map((tier) => ({ when: { ...tier.when } }))
}

function toOption(model: NoriBusinessModel): UserModelOption {
  const option: UserModelOption = {
    value: model.key,
    label: model.name,
    provider: 'nori',
    providerName: 'LanmiaoTV',
    tier: model.tier,
  }
  const target = parseModelKeyStrict(resolveNoriModelRoute(model.key) || '')
  if (!target) return option

  const capabilities = findBuiltinCapabilities(model.type, target.provider, target.modelId)
  if (capabilities) option.capabilities = capabilities
  if (model.type === 'video') {
    const pricing = findBuiltinPricingCatalogEntry('video', target.provider, target.modelId)
    if (pricing?.pricing.mode === 'capability' && Array.isArray(pricing.pricing.tiers)) {
      option.videoPricingTiers = cloneVideoPricingTiers(pricing.pricing.tiers)
    }
  }
  return option
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const llm = listNoriBusinessModels('llm').map(toOption)
  const image = listNoriBusinessModels('image').map(toOption)
  const video = listNoriBusinessModels('video').map(toOption)
  const audio = listNoriBusinessModels('audio').map(toOption)
  return NextResponse.json({
    text: llm,
    llm,
    vision: [],
    image,
    video,
    audio,
    lipsync: [],
  } satisfies UserModelsPayload)
})
