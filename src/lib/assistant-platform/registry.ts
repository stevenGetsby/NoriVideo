import type { AssistantId, AssistantSkillDefinition } from './types'
import { tutorialSkill } from './skills/tutorial'

const SKILLS: Record<AssistantId, AssistantSkillDefinition> = {
  tutorial: tutorialSkill,
}

export function getAssistantSkill(id: AssistantId): AssistantSkillDefinition {
  return SKILLS[id]
}

export function isAssistantId(value: unknown): value is AssistantId {
  return value === 'tutorial'
}
