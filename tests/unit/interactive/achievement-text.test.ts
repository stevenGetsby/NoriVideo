import { describe, expect, it } from 'vitest'
import { achievementConditionText, achievementRewardText, valueText, type AchievementTextContext } from '@/lib/interactive/achievement-text'
import { compileChapter } from '@/lib/interactive/compile'
import { storyPlaces } from '@/lib/interactive/places'
import type { StoryAchievementCondition, StoryVariable } from '@/lib/interactive/types'
import { achievements, coin, storyEdges, storyNodes } from './p3-fixture'

const flag: StoryVariable = { id: 'key', name: '钥匙', type: 'boolean', initial: false }
const context: AchievementTextContext = {
  places: storyPlaces([compileChapter({ projectId: 'p', title: '第一章' }, storyNodes.map((node) => (node.id === 'goodend' ? { ...node, data: { ...(node.data as Record<string, unknown>), title: '好结局' } } : node)), storyEdges)]),
  variables: [coin, flag],
}
const text = (condition: StoryAchievementCondition) => achievementConditionText(condition, context)

describe('achievement condition text', () => {
  it('names the ending and the segment', () => {
    expect(text({ type: 'ending', projectId: 'p', nodeId: 'goodend' })).toBe('到达结局「好结局」')
    expect(text({ type: 'segment', projectId: 'p', nodeId: 's2' })).toBe('到达片段「s2」')
  })

  it('does not fail on a place the known chapters do not contain', () => {
    expect(text({ type: 'ending', projectId: 'other', nodeId: 'x' })).toBe('到达结局「未知结局」')
    expect(text({ type: 'segment', projectId: 'p', nodeId: 'gone' })).toBe('到达片段「未知片段」')
  })

  it('reads number comparisons in plain Chinese', () => {
    expect(text({ type: 'value', variableId: 'coin', op: '>=', value: 3 })).toBe('数值「金币」达到 3')
    expect(text({ type: 'value', variableId: 'coin', op: '>', value: 3 })).toBe('数值「金币」超过 3')
    expect(text({ type: 'value', variableId: 'coin', op: '<=', value: 3 })).toBe('数值「金币」不超过 3')
    expect(text({ type: 'value', variableId: 'coin', op: '<', value: 3 })).toBe('数值「金币」低于 3')
    expect(text({ type: 'value', variableId: 'coin', op: '==', value: 0 })).toBe('数值「金币」等于 0')
    expect(text({ type: 'value', variableId: 'coin', op: '!=', value: 0 })).toBe('数值「金币」不等于 0')
    expect(text({ type: 'value', variableId: 'ghost', op: '>=', value: 1 })).toBe('数值「未知数值」达到 1')
  })

  it('reads yes/no values as a state', () => {
    expect(text({ type: 'value', variableId: 'key', op: '==', value: true })).toBe('「钥匙」为 是')
    expect(text({ type: 'value', variableId: 'key', op: '==', value: false })).toBe('「钥匙」为 否')
    expect(text({ type: 'value', variableId: 'key', op: '!=', value: true })).toBe('「钥匙」不为 是')
    expect(valueText(true)).toBe('是')
    expect(valueText(false)).toBe('否')
    expect(valueText(2.5)).toBe('2.5')
  })

  it('reads the collection goals', () => {
    expect(text({ type: 'all_endings' })).toBe('集齐全部结局')
    expect(text({ type: 'all_achievements' })).toBe('完成全部其他成就')
  })

  it('has a sentence for every achievement of the fixture', () => {
    for (const achievement of achievements) expect(text(achievement.condition).length).toBeGreaterThan(2)
  })
})

describe('achievement reward text', () => {
  it('lists the title and the avatar frame, and says so when there is nothing', () => {
    expect(achievementRewardText({ title: '最强王者', frameUrl: '/gold.png' })).toBe('称号「最强王者」 + 头像框')
    expect(achievementRewardText({ title: '最强王者', frameUrl: null })).toBe('称号「最强王者」')
    expect(achievementRewardText({ title: '  ', frameUrl: '/gold.png' })).toBe('头像框')
    expect(achievementRewardText({ title: '', frameUrl: null })).toBe('无奖励')
  })
})
