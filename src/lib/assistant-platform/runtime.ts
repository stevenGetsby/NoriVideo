import { convertToModelMessages, safeValidateUIMessages, stepCountIs, streamText, type LanguageModel, type UIMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { getProviderConfig, getProviderKey } from '@/lib/api-config'
import { getUserModelConfig } from '@/lib/config-service'
import { resolveLlmRuntimeModel } from '@/lib/llm/runtime-shared'
import {
  prepareStreamingTextBilling,
  rollbackStreamingTextBilling,
  settleStreamingTextBilling,
} from '@/lib/billing/service'
import { recordServiceUsage } from '@/lib/platform-services/usage'
import { AssistantPlatformError } from './errors'
import { getAssistantSkill } from './registry'
import type {
  AssistantContext,
  AssistantId,
  AssistantResolvedModel,
  AssistantRuntimeContext,
} from './types'

function normalizeAssistantContext(raw: unknown): AssistantContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  const providerId = typeof record.providerId === 'string' ? record.providerId.trim() : ''
  const locale = typeof record.locale === 'string' ? record.locale.trim() : ''
  return {
    ...(providerId ? { providerId } : {}),
    ...(locale ? { locale } : {}),
  }
}

async function toModelMessages(messages: UIMessage[]): Promise<Awaited<ReturnType<typeof convertToModelMessages>>> {
  const withoutIds = messages.map((message) => {
    const { id: _id, ...rest } = message
    return rest
  })
  return await convertToModelMessages(withoutIds)
}

async function resolveAssistantLanguageModel(input: {
  userId: string
  analysisModelKey: string
}): Promise<{
  resolvedModel: AssistantResolvedModel
  languageModel: LanguageModel
}> {
  const selection = await resolveLlmRuntimeModel(input.userId, input.analysisModelKey)
  const providerConfig = await getProviderConfig(input.userId, selection.provider)
  const providerKey = getProviderKey(selection.provider)

  if (providerKey !== 'deepseek') {
    throw new Error(`TEXT_PROVIDER_UNSUPPORTED: 文本生成仅支持 DeepSeek 官方 API (${selection.provider})`)
  }

  const openai = createOpenAI({
    apiKey: providerConfig.apiKey,
    ...(providerConfig.baseUrl ? { baseURL: providerConfig.baseUrl } : {}),
    name: providerKey,
  })
  return {
    resolvedModel: {
      providerId: selection.provider,
      providerKey,
      modelId: selection.modelId,
    },
    languageModel: openai.chat(selection.modelId),
  }
}

export async function createAssistantChatResponse(input: {
  userId: string
  assistantId: AssistantId
  context: unknown
  messages: unknown
}): Promise<Response> {
  const validation = await safeValidateUIMessages({ messages: input.messages })
  if (!validation.success) {
    throw new AssistantPlatformError('ASSISTANT_INVALID_REQUEST', 'messages payload is invalid')
  }

  const normalizedMessages = validation.data
  if (normalizedMessages.length === 0) {
    throw new AssistantPlatformError('ASSISTANT_INVALID_REQUEST', 'messages must not be empty')
  }

  const userConfig = await getUserModelConfig(input.userId)
  const analysisModelKey = userConfig.analysisModel?.trim() || ''
  if (!analysisModelKey) {
    throw new AssistantPlatformError('ASSISTANT_MODEL_NOT_CONFIGURED', 'analysisModel is required')
  }

  const context = normalizeAssistantContext(input.context)
  const skill = getAssistantSkill(input.assistantId)
  const resolved = await resolveAssistantLanguageModel({
    userId: input.userId,
    analysisModelKey,
  })
  const runtimeContext: AssistantRuntimeContext = {
    userId: input.userId,
    assistantId: input.assistantId,
    context,
    analysisModelKey,
    resolvedModel: resolved.resolvedModel,
  }

  const tools = skill.tools ? skill.tools(runtimeContext) : undefined
  const systemPrompt = skill.systemPrompt(runtimeContext)
  const maxSteps = skill.maxSteps ?? 4
  const maxOutputTokensPerStep = 8_192
  const preparedBilling = await prepareStreamingTextBilling({
    userId: input.userId,
    projectId: `assistant:${input.assistantId}`,
    action: `assistant_${input.assistantId}`,
    model: analysisModelKey,
    maxInputTokens: Math.min(
      256_000,
      Math.max(4_000, Math.ceil((systemPrompt.length + JSON.stringify(normalizedMessages).length) * 1.5)),
    ),
    maxOutputTokens: maxOutputTokensPerStep * maxSteps,
    metadata: {
      assistantId: input.assistantId,
      maxSteps,
    },
  })
  const startedAt = Date.now()
  let billingFinalized = false

  const rollbackBilling = async (errorCode: string) => {
    if (billingFinalized) return
    billingFinalized = true
    await rollbackStreamingTextBilling(preparedBilling)
    await recordServiceUsage({
      provider: resolved.resolvedModel.providerId,
      modelKey: analysisModelKey,
      serviceType: 'llm',
      operation: `assistant:${input.assistantId}`,
      status: 'failed',
      userId: input.userId,
      latencyMs: Date.now() - startedAt,
      errorCode,
    })
  }

  let result: ReturnType<typeof streamText>
  try {
    result = streamText({
      model: resolved.languageModel,
      system: systemPrompt,
      messages: await toModelMessages(normalizedMessages),
      ...(tools ? { tools } : {}),
      stopWhen: stepCountIs(maxSteps),
      temperature: skill.temperature ?? 0.2,
      maxOutputTokens: maxOutputTokensPerStep,
      onFinish: async ({ totalUsage }) => {
        if (billingFinalized) return
        billingFinalized = true
        const inputTokens = totalUsage.inputTokens || 0
        const outputTokens = totalUsage.outputTokens || 0
        await settleStreamingTextBilling(preparedBilling, {
          model: `${resolved.resolvedModel.providerId}::${resolved.resolvedModel.modelId}`,
          inputTokens,
          outputTokens,
        })
        await recordServiceUsage({
          provider: resolved.resolvedModel.providerId,
          modelKey: analysisModelKey,
          serviceType: 'llm',
          operation: `assistant:${input.assistantId}`,
          userId: input.userId,
          inputTokens,
          outputTokens,
          units: maxSteps,
          latencyMs: Date.now() - startedAt,
        })
      },
      onError: async () => {
        await rollbackBilling('ASSISTANT_STREAM_FAILED')
      },
      onAbort: async () => {
        await rollbackBilling('ASSISTANT_STREAM_ABORTED')
      },
    })
  } catch (error) {
    await rollbackBilling('ASSISTANT_STREAM_START_FAILED')
    throw error
  }

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      if (error instanceof Error && error.message) return error.message
      return 'assistant stream failed'
    },
  })
}
