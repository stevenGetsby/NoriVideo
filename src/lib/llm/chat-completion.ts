import OpenAI from 'openai'
import { runOpenAICompatChatCompletion } from '@/lib/model-gateway'
import { getProviderConfig, getProviderKey } from '../api-config'
import { getInternalLLMStreamCallbacks } from '../llm-observe/internal-stream-context'
import type { ChatCompletionOptions } from './types'
import { getCompletionParts } from './completion-parts'
import {
  _ulogError,
  completionUsageSummary,
  isRetryableError,
  llmLogger,
  logLlmRawInput,
  logLlmRawOutput,
  recordCompletionUsage,
  recordFailedCompletionUsage,
  resolveLlmRuntimeModel,
} from './runtime-shared'

export async function chatCompletion(
  userId: string,
  model: string | null | undefined,
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  options: ChatCompletionOptions = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const internalCallbacks = getInternalLLMStreamCallbacks()
  if (internalCallbacks && !options.__skipAutoStream) {
    const { chatCompletionStream } = await import('./chat-stream')
    return chatCompletionStream(userId, model, messages, { ...options, __skipAutoStream: true }, internalCallbacks)
  }
  if (!model) {
    _ulogError('[LLM] 模型未配置，调用栈:', new Error().stack)
    throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
  }

  const selection = await resolveLlmRuntimeModel(userId, model)
  const provider = selection.provider
  const providerKey = getProviderKey(provider).toLowerCase()
  if (providerKey !== 'deepseek') {
    throw new Error(`TEXT_PROVIDER_UNSUPPORTED: 文本生成仅支持 DeepSeek 官方 API (${provider})`)
  }
  if (selection.llmProtocol !== 'chat-completions') {
    throw new Error(`MODEL_LLM_PROTOCOL_REQUIRED: ${selection.modelKey} 必须使用 chat-completions`)
  }
  const providerConfig = await getProviderConfig(userId, provider)
  const projectId = options.projectId?.trim() || undefined
  const temperature = options.temperature ?? 0.7
  const reasoning = options.reasoning ?? true
  const reasoningEffort = options.reasoningEffort || 'high'
  const maxRetries = options.maxRetries ?? 2
  logLlmRawInput({
    userId, projectId, provider: providerKey, modelId: selection.modelId,
    modelKey: selection.modelKey, stream: false, reasoning, reasoningEffort,
    temperature, action: options.action, messages,
  })

  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const startedAt = Date.now()
    try {
      const completion = await runOpenAICompatChatCompletion({
        userId, providerId: provider, modelId: selection.modelId, messages, temperature,
      })
      const parts = getCompletionParts(completion)
      logLlmRawOutput({
        userId, projectId, provider: providerKey, modelId: selection.modelId,
        modelKey: selection.modelKey, stream: false, action: options.action,
        text: parts.text, reasoning: parts.reasoning, usage: completionUsageSummary(completion),
      })
      recordCompletionUsage(selection.modelId, completion, {
        userId, provider, modelKey: selection.modelKey, projectId,
        operation: options.action || 'chat-completion', latencyMs: Date.now() - startedAt,
      })
      llmLogger.info({ action: 'llm.call.success', message: 'llm call succeeded', provider: providerKey })
      return completion
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      llmLogger.warn({ action: 'llm.call.attempt_failed', message: lastError.message, provider })
      if (!isRetryableError(error) || attempt > maxRetries) break
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** (attempt - 1), 5000)))
    }
  }
  recordFailedCompletionUsage({
    userId, provider, modelKey: selection.modelKey, projectId,
    operation: options.action || 'chat-completion', errorCode: lastError?.name || 'LLM_CALL_FAILED',
  })
  throw lastError || new Error('LLM 调用失败')
}
