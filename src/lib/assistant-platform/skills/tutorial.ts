import type { AssistantRuntimeContext, AssistantSkillDefinition } from '../types'
import { renderAssistantSystemPrompt } from '../system-prompts'

function buildTutorialPrompt(_ctx: AssistantRuntimeContext): string {
  void _ctx
  return renderAssistantSystemPrompt('tutorial')
}

export const tutorialSkill: AssistantSkillDefinition = {
  id: 'tutorial',
  systemPrompt: buildTutorialPrompt,
  temperature: 0.2,
  maxSteps: 4,
}
