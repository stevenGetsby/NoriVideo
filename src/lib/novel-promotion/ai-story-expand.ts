import { executeAiTextStep } from '@/lib/ai-runtime'
import { buildPrompt, PROMPT_IDS, type PromptLocale } from '@/lib/prompt-i18n'

export type AiStoryExpansionInput = {
  userId: string
  model: string
  prompt: string
  locale: PromptLocale
  projectId?: string
  action?: string
  stepId?: string
  stepTitle?: string
  stepIndex?: number
  stepTotal?: number
}

export type AiStoryExpansionResult = {
  expandedText: string
}

export function buildAiStoryExpandPrompt(input: {
  prompt: string
  locale: PromptLocale
}): string {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_AI_STORY_EXPAND,
    locale: input.locale,
    variables: {
      input: input.prompt,
    },
  })
}

export async function executeAiStoryExpansion(input: AiStoryExpansionInput): Promise<AiStoryExpansionResult> {
  const promptInput = input.prompt.trim()
  const model = input.model.trim()
  if (!promptInput) {
    throw new Error('prompt is required')
  }
  if (!model) {
    throw new Error('analysisModel is required')
  }

  const prompt = buildAiStoryExpandPrompt({
    prompt: promptInput,
    locale: input.locale,
  })
  const completion = await executeAiTextStep({
    userId: input.userId,
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    projectId: input.projectId || 'home-ai-write',
    action: input.action || 'ai_story_expand',
    meta: {
      stepId: input.stepId || 'ai_story_expand',
      stepTitle: input.stepTitle || '故事扩写',
      stepIndex: input.stepIndex || 1,
      stepTotal: input.stepTotal || 1,
    },
  })

  const expandedText = completion.text.trim()
  if (!expandedText) {
    throw new Error('AI story expand response is empty')
  }

  return {
    expandedText,
  }
}
