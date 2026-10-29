import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'

export type AssistantPromptId = 'tutorial'

export function renderAssistantSystemPrompt(
  _promptId: AssistantPromptId,
  vars?: Record<string, string>,
): string {
  return buildPrompt({
    promptId: PROMPT_IDS.ASSISTANT_TUTORIAL_SYSTEM,
    locale: vars?.locale === 'en' ? 'en' : 'zh',
  })
}
