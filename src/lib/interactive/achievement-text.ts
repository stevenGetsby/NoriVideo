import { findPlace, placeLabel, type StoryPlaces } from './places'
import type { StoryAchievementCondition, StoryCompareOp, StoryReward, StoryValue, StoryVariable } from './types'

export const COMPARE_PHRASES: Record<StoryCompareOp, string> = {
  '>=': '达到',
  '>': '超过',
  '<=': '不超过',
  '<': '低于',
  '==': '等于',
  '!=': '不等于',
}

export const valueText = (value: StoryValue): string => (typeof value === 'boolean' ? (value ? '是' : '否') : String(value))

export interface AchievementTextContext {
  places: StoryPlaces
  variables: readonly StoryVariable[]
}

/** The condition as a creator or viewer reads it, e.g. `到达结局「好结局」` or `数值「金币」达到 3`. */
export function achievementConditionText(condition: StoryAchievementCondition, context: AchievementTextContext): string {
  switch (condition.type) {
    case 'ending':
      return `到达结局「${placeLabel(findPlace(context.places, 'ending', condition.projectId, condition.nodeId), 'ending')}」`
    case 'segment':
      return `到达片段「${placeLabel(findPlace(context.places, 'segment', condition.projectId, condition.nodeId), 'segment')}」`
    case 'value': {
      const variable = context.variables.find((candidate) => candidate.id === condition.variableId)
      const name = variable?.name.trim() || '未知数值'
      if (typeof condition.value === 'boolean') return `「${name}」${condition.op === '!=' ? '不为' : '为'} ${valueText(condition.value)}`
      return `数值「${name}」${COMPARE_PHRASES[condition.op]} ${valueText(condition.value)}`
    }
    case 'all_endings':
      return '集齐全部结局'
    case 'all_achievements':
      return '完成全部其他成就'
  }
}

/** What the reward gives, e.g. `称号「最强王者」+ 头像框`; `无奖励` when it gives nothing. */
export function achievementRewardText(reward: StoryReward): string {
  const title = reward.title.trim()
  const parts = [title ? `称号「${title}」` : '', reward.frameUrl ? '头像框' : ''].filter(Boolean)
  return parts.length ? parts.join(' + ') : '无奖励'
}
