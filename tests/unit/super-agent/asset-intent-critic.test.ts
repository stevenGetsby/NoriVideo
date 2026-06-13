import { describe, expect, it } from 'vitest'
import {
  decorateLocationSummaryWithIntent,
  inferAgentAssetIntentCritic,
} from '@/lib/super-agent/asset-intent-critic'

describe('Agent asset intent critic', () => {
  it('locks western context for English or American short-drama prompts', () => {
    const critic = inferAgentAssetIntentCritic([
      '请用 Agent 自动创作模式生成一支 9:16 欧美医疗短剧转绘视频，真实真人短剧质感，英文口型。',
      'Ava is a young American woman talking with Dr. Grayson in a hospital.',
    ])

    expect(critic.regionIntent).toBe('western')
    expect(critic.defaultLocationName).toContain('国外')
    expect(critic.regionConstraint).toContain('国外场景')
    expect(critic.regionConstraint).toContain('英文环境标识')
    expect(critic.regionConstraint).toContain('不得误生成中国街景')
  })

  it('locks China context for Chinese story prompts', () => {
    const critic = inferAgentAssetIntentCritic([
      '生成一个发生在上海社区医院的中国故事，角色说中文。',
    ])

    expect(critic.regionIntent).toBe('china')
    expect(critic.defaultLocationName).toContain('中国')
    expect(critic.regionConstraint).toContain('中国场景')
    expect(critic.regionConstraint).toContain('中文环境标识')
    expect(critic.regionConstraint).toContain('不得误生成欧美街景')
  })

  it('decorates location summaries with the critic exactly once', () => {
    const critic = inferAgentAssetIntentCritic(['English hospital story'])
    const summary = decorateLocationSummaryWithIntent('现代医院走廊', critic)

    expect(summary).toContain('现代医院走廊。地域/语言 critic：')
    expect(decorateLocationSummaryWithIntent(summary, critic)).toBe(summary)
  })
})
