import type { AgentCreativeParameters, SkillId } from '@/lib/super-agent/types'

export const SKILL_OPTIONS: Array<{ value: SkillId; label: string }> = [
  { value: 'digital-avatar-ad', label: '数字人口播' },
  { value: 'travel-master', label: '旅拍大师' },
  { value: 'product-promo', label: '商品宣传短片' },
  { value: 'food-documentary', label: '舌尖美食' },
  { value: 'music-mv', label: '音乐MV' },
  { value: 'generic', label: '通用视频制作' },
]

export const DEFAULT_PARAMETERS: AgentCreativeParameters = {
  durationSeconds: 30,
  targetAudience: '',
  tone: '自然、清晰',
  sellingPoints: '',
  callToAction: '',
  narration: 'auto',
  shotCount: 3,
  panelsPerShot: 3,
  mockPrompt: 'Mock prompt: 本地生成可编辑的项目、剧本、分镜、提示词和配音行，不调用外部模型。',
}

export function numberValue(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

export const fieldStyle = {
  background: 'var(--glass-bg-surface)',
  border: '1px solid var(--glass-stroke-base)',
}
