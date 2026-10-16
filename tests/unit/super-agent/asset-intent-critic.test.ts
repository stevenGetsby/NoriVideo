import { describe, expect, it } from 'vitest'
import {
  decorateLocationSummaryWithIntent,
  inferAgentAssetIntentCritic,
} from '@/lib/super-agent/asset-intent-critic'
import { buildAgentStoryPackage, serializeAgentStoryPackage } from '@/lib/super-agent/agent-story-package'
import { createDeterministicAnalysis } from '@/lib/super-agent/plan-utils'

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
  it('does not classify negated Western requirements as positive region intent', () => {
    expect(inferAgentAssetIntentCritic(['中国场景，中文环境；不要欧美街景或英文环境标识。']).regionIntent).toBe('china')
    expect(inferAgentAssetIntentCritic(['American hospital. Do not use Chinese streets.']).regionIntent).toBe('western')
  })
  it('prioritizes the explicit story package region over serialized safety rules mentioning both regions', () => {
    const input = '中国小镇的中文故事'
    const story = buildAgentStoryPackage({ userInput: input, analysis: createDeterministicAnalysis(input) })
    story.settingRegion = 'china'
    story.criticRules = ['不要误生成欧美街景或英文环境']
    expect(inferAgentAssetIntentCritic([serializeAgentStoryPackage(story)]).regionIntent).toBe('china')
    story.settingRegion = 'western'
    story.criticRules = ['不得误生成中国场景、中文招牌']
    expect(inferAgentAssetIntentCritic([serializeAgentStoryPackage(story)]).regionIntent).toBe('western')
  })
})
