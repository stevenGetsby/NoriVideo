import { getRawProviderKey } from '@/lib/model-provider-contract'
import type { NoriBusinessModel, NoriBusinessModelKey } from '@/lib/nori-model-catalog'
import { TGG_VIDEO_ROUTE_BY_BUSINESS_KEY } from '@/lib/providers/tgg/routes'

export type VideoProvider = 'kuaizi' | 'tgg'
export type VideoProviderState = VideoProvider | 'mixed'

export type VideoSwitchPlanRow = {
  businessKey: string
  name: string
  from: string
  to: string
  action: 'switch' | 'keep' | 'unavailable'
  reason?: string
}

export type VideoSwitchPlan = {
  current: VideoProviderState
  target: VideoProvider
  rows: VideoSwitchPlanRow[]
  blockers: string[]
  applied: boolean
}

export function deriveVideoProvider(
  routing: Record<string, string>,
  videoBusinessKeys: string[],
): VideoProviderState {
  const providers = new Set<VideoProvider>()
  for (const key of videoBusinessKeys) {
    const provider = getRawProviderKey(routing[key] || '').toLowerCase()
    if (provider === 'kuaizi' || provider === 'tgg') providers.add(provider)
  }
  if (providers.size === 1) return providers.values().next().value as VideoProvider
  if (providers.size > 1) return 'mixed'
  return 'kuaizi'
}

export function planVideoProviderSwitch(input: {
  routing: Record<string, string>
  businessModels: NoriBusinessModel[]
  selectableTgg: string[]
  hasTggKey: boolean
  hasKuaiziKey: boolean
  target: VideoProvider
}): VideoSwitchPlan {
  const videoModels = input.businessModels.filter((model) => model.type === 'video')
  const current = deriveVideoProvider(input.routing, videoModels.map((model) => model.key))
  const selectable = new Set(input.selectableTgg)
  const rows: VideoSwitchPlanRow[] = videoModels.map((model) => {
    const from = input.routing[model.key] || model.suggestedRoute || ''
    if (input.target === 'kuaizi') {
      const to = model.suggestedRoute
      return { businessKey: model.key, name: model.name, from, to, action: from === to ? 'keep' : 'switch' }
    }
    const mapped = TGG_VIDEO_ROUTE_BY_BUSINESS_KEY[model.key as NoriBusinessModelKey]
    if (!mapped) {
      return { businessKey: model.key, name: model.name, from, to: from, action: 'keep', reason: 'TGG 暂无对应模型' }
    }
    if (!selectable.has(mapped)) {
      return { businessKey: model.key, name: model.name, from, to: from, action: 'unavailable', reason: '该模型 TGG 未定价或能力未核实' }
    }
    return { businessKey: model.key, name: model.name, from, to: mapped, action: from === mapped ? 'keep' : 'switch' }
  })

  const blockers: string[] = []
  if (input.target === 'tgg' && !input.hasTggKey) blockers.push('TGG 尚未配置 API Key')
  if (input.target === 'kuaizi' && !input.hasKuaiziKey) blockers.push('Kuaizi 尚未配置 API Key')
  if (current !== input.target && !rows.some((row) => row.action === 'switch')) blockers.push('没有可切换的模型')
  return { current, target: input.target, rows, blockers, applied: false }
}
