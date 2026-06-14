import { getCompletionContent } from '@/lib/llm-client'
import { runModelGatewayTextCompletion } from '@/lib/model-gateway/llm'
import { createScopedLogger } from '@/lib/logging/core'
import { getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { LUMINA_GPT55_MODEL_KEY } from '@/lib/lumina-fixed-models'

type SuperAgentLlmOptions = {
  action?: string
  projectId?: string
  temperature?: number
  reasoning?: boolean
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  timeoutMs?: number
}

type LlmAttempt = {
  model: string
  attempt: number
  durationMs: number
  error: string
}

const DEFAULT_TIMEOUT_MS = 45_000

const logger = createScopedLogger({
  module: 'super-agent',
  action: 'super-agent.llm',
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) return await promise

  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label}: timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class SuperAgentLLMClient {
  async callLLM(
    userId: string,
    systemPrompt: string,
    userPrompt: string,
    options: SuperAgentLlmOptions = {},
  ): Promise<string> {
    const timeoutMs = Math.max(10_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const action = options.action || 'super-agent.llm'
    const attempts: LlmAttempt[] = []
    const projectConfig = options.projectId
      ? await getProjectModelConfig(options.projectId, userId).catch(() => null)
      : null
    const userConfig = projectConfig ? null : await getUserModelConfig(userId).catch(() => null)
    const selectedCandidates = [
      projectConfig?.analysisModel?.trim() || userConfig?.analysisModel?.trim() || LUMINA_GPT55_MODEL_KEY,
    ]

    for (let index = 0; index < selectedCandidates.length; index += 1) {
      const model = selectedCandidates[index]
      const startedAt = Date.now()
      try {
        logger.info({
          message: 'super agent llm attempt started',
          action,
          userId,
          projectId: options.projectId,
          details: {
            model,
            attempt: index + 1,
            totalCandidates: selectedCandidates.length,
            timeoutMs,
          },
        })

        const completion = await withTimeout(
          runModelGatewayTextCompletion({
            userId,
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            options: {
              temperature: options.temperature ?? 0.2,
              reasoning: options.reasoning ?? true,
              reasoningEffort: options.reasoningEffort ?? 'medium',
              maxRetries: 0,
              projectId: options.projectId,
              action,
            },
          }),
          timeoutMs,
          `${action}:${model}`,
        )

        const content = getCompletionContent(completion).trim()
        if (!content) {
          throw new Error(`${action}: empty LLM response`)
        }

        logger.info({
          message: 'super agent llm attempt succeeded',
          action,
          userId,
          projectId: options.projectId,
          durationMs: Date.now() - startedAt,
          details: {
            model,
            attempt: index + 1,
          },
        })
        return content
      } catch (error) {
        const attempt: LlmAttempt = {
          model,
          attempt: index + 1,
          durationMs: Date.now() - startedAt,
          error: errorMessage(error),
        }
        attempts.push(attempt)
        logger.warn({
          message: 'super agent llm attempt failed',
          action,
          userId,
          projectId: options.projectId,
          durationMs: attempt.durationMs,
          details: attempt,
        })
      }
    }

    const summary = attempts
      .map((attempt) => `${attempt.model}: ${attempt.error}`)
      .join(' | ')
    throw new Error(`${action}: all configured text models failed. ${summary}`)
  }
}

export const llmClient = new SuperAgentLLMClient()
