import OpenAI from 'openai'
import { runOpenAICompatChatCompletionStream } from '@/lib/model-gateway'
import { getProviderConfig, getProviderKey } from '../api-config'
import type { ChatCompletionOptions, ChatCompletionStreamCallbacks } from './types'
import { getCompletionParts } from './completion-parts'
import { emitStreamStage, resolveStreamStepMeta } from './stream-helpers'
import {
  completionUsageSummary,
  logLlmRawInput,
  logLlmRawOutput,
  recordCompletionUsage,
  recordFailedCompletionUsage,
  resolveLlmRuntimeModel,
} from './runtime-shared'

export async function chatCompletionStream(
  userId: string,
  model: string | null | undefined,
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  options: ChatCompletionOptions = {},
  callbacks?: ChatCompletionStreamCallbacks,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const streamStep = resolveStreamStepMeta(options)
  emitStreamStage(callbacks, streamStep, 'submit')
  if (!model) {
    const error = new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
    callbacks?.onError?.(error, streamStep)
    throw error
  }

  const selection = await resolveLlmRuntimeModel(userId, model)
  const provider = selection.provider
  const providerKey = getProviderKey(provider).toLowerCase()
  const projectId = options.projectId?.trim() || undefined
  const startedAt = Date.now()
  try {
    if (providerKey !== 'deepseek') {
      throw new Error(`TEXT_PROVIDER_UNSUPPORTED: 文本生成仅支持 DeepSeek 官方 API (${provider})`)
    }
    if (selection.llmProtocol !== 'chat-completions') {
      throw new Error(`MODEL_LLM_PROTOCOL_REQUIRED: ${selection.modelKey} 必须使用 chat-completions`)
    }
    await getProviderConfig(userId, provider)
    logLlmRawInput({
      userId, projectId, provider: providerKey, modelId: selection.modelId,
      modelKey: selection.modelKey, stream: true, reasoning: options.reasoning ?? true,
      reasoningEffort: options.reasoningEffort || 'high', temperature: options.temperature ?? 0.7,
      action: options.action, messages,
    })
    emitStreamStage(callbacks, streamStep, 'streaming', 'deepseek')
    const completion = await runOpenAICompatChatCompletionStream({
      userId, providerId: provider, modelId: selection.modelId, messages,
      temperature: options.temperature ?? 0.7,
    }, callbacks, streamStep)
    const parts = getCompletionParts(completion)
    logLlmRawOutput({
      userId, projectId, provider: providerKey, modelId: selection.modelId,
      modelKey: selection.modelKey, stream: true, action: options.action,
      text: parts.text, reasoning: parts.reasoning, usage: completionUsageSummary(completion),
    })
    recordCompletionUsage(selection.modelId, completion, {
      userId, provider, modelKey: selection.modelKey, projectId,
      operation: options.action || 'chat-completion-stream', latencyMs: Date.now() - startedAt,
    })
    emitStreamStage(callbacks, streamStep, 'completed', 'deepseek')
    callbacks?.onComplete?.(parts.text, streamStep)
    return completion
  } catch (error) {
    recordFailedCompletionUsage({
      userId, provider, modelKey: selection.modelKey, projectId,
      operation: options.action || 'chat-completion-stream', latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : 'LLM_STREAM_FAILED',
    })
    callbacks?.onError?.(error, streamStep)
    throw error
  }
}
