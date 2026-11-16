import { listNoriBusinessModels, type NoriBusinessModelKey } from '@/lib/nori-model-catalog'

// 业务视频模型 → 默认 TGG 路由。只在“同一模型家族”且 /v1/models 核实后才填；
// 跨家族一律留空（空 = 一键切换时该项保持 Kuaizi）。映射值还必须出现在
// listTggSelectableModels() 里才会生效。
export const TGG_VIDEO_ROUTE_BY_BUSINESS_KEY: Partial<Record<NoriBusinessModelKey, string>> = {
  // key 到手并核实 /v1/models 后再填，例如：
  // 'nori::norivideo2.5': 'tgg::seedance_v2.5_full',
}

export const VIDEO_BUSINESS_KEYS: NoriBusinessModelKey[] = listNoriBusinessModels('video').map((model) => model.key)
