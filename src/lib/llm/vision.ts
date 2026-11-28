import OpenAI from 'openai'
import { runOpenAICompatChatCompletion } from '@/lib/model-gateway'
import type { OpenAICompatMessageContent } from '@/lib/model-gateway/types'
import { getProviderConfig, getProviderKey } from '../api-config'
import { getInternalLLMStreamCallbacks } from '../llm-observe/internal-stream-context'
import type { ChatCompletionOptions, ChatCompletionStreamCallbacks } from './types'
import { emitChunkedText } from './stream-helpers'
import { getCompletionParts } from './completion-parts'
import {
  _ulogError,
  completionUsageSummary,
  isRetryableError,
  llmLogger,
  logLlmRawOutput,
  recordCompletionUsage,
  recordFailedCompletionUsage,
  resolveLlmRuntimeModel,
} from './runtime-shared'

export async function chatCompletionWithVision(
  userId: string,
  model: string | null | undefined,
  textPrompt: string,
  imageUrls: string[] = [],
  options: ChatCompletionOptions = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const internalCallbacks = getInternalLLMStreamCallbacks()
  if (internalCallbacks && !options.__skipAutoStream) {
    return chatCompletionWithVisionStream(
      userId, model, textPrompt, imageUrls, { ...options, __skipAutoStream: true }, internalCallbacks,
    )
  }
  if (!model) {
    _ulogError('[LLM Vision] 模型未配置，调用栈:', new Error().stack)
    throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
  }
  const selection = await resolveLlmRuntimeModel(userId, model)
  const provider = selection.provider
  const providerKey = getProviderKey(provider).toLowerCase()
  if (providerKey !== 'openlux') {
    throw new Error(`TEXT_PROVIDER_UNSUPPORTED: 文本与多模态理解仅支持 OpenLux API (${provider})`)
  }
  if (selection.llmProtocol !== 'chat-completions') {
    throw new Error(`MODEL_LLM_PROTOCOL_REQUIRED: ${selection.modelKey} 必须使用 chat-completions`)
  }
  await getProviderConfig(userId, provider, selection.modelId)

  const validImageUrls = imageUrls
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
  const content: OpenAICompatMessageContent = validImageUrls.length > 0
    ? [
        { type: 'text', text: textPrompt },
        ...validImageUrls.map((url) => ({
          type: 'image_url' as const,
          image_url: { url },
        })),
      ]
    : textPrompt

  const projectId = options.projectId?.trim() || undefined
  const temperature = options.temperature ?? 0.7
  const maxRetries = options.maxRetries ?? 2
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const startedAt = Date.now()
    try {
      const completion = await runOpenAICompatChatCompletion({
        userId,
        providerId: provider,
        modelId: selection.modelId,
        messages: [{ role: 'user', content }],
        temperature,
      })
      const parts = getCompletionParts(completion)
      logLlmRawOutput({
        userId,
        projectId,
        provider: providerKey,
        modelId: selection.modelId,
        modelKey: selection.modelKey,
        stream: false,
        action: options.action || 'chat-completion-vision',
        text: parts.text,
        reasoning: parts.reasoning,
        usage: completionUsageSummary(completion),
      })
      recordCompletionUsage(selection.modelKey, completion, {
        userId,
        provider,
        modelKey: selection.modelKey,
        projectId,
        operation: options.action || 'chat-completion-vision',
        latencyMs: Date.now() - startedAt,
      })
      return completion
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      llmLogger.warn({ action: 'llm.vision.attempt_failed', message: lastError.message, provider })
      if (!isRetryableError(error) || attempt > maxRetries) break
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** (attempt - 1), 5000)))
    }
  }

  recordFailedCompletionUsage({
    userId,
    provider,
    modelKey: selection.modelKey,
    projectId,
    operation: options.action || 'chat-completion-vision',
    errorCode: lastError?.name || 'LLM_VISION_CALL_FAILED',
  })
  throw lastError || new Error('LLM 多模态调用失败')
}

export async function chatCompletionWithVisionStream(
  userId: string,
  model: string | null | undefined,
  textPrompt: string,
  imageUrls: string[] = [],
  options: ChatCompletionOptions = {},
  callbacks?: ChatCompletionStreamCallbacks,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  callbacks?.onStage?.({ stage: 'submit' })
  try {
    const completion = await chatCompletionWithVision(userId, model, textPrompt, imageUrls, {
      ...options, __skipAutoStream: true,
    })
    const parts = getCompletionParts(completion)
    let seq = 1
    if (parts.reasoning) seq = emitChunkedText(parts.reasoning, callbacks, 'reasoning', seq)
    emitChunkedText(parts.text, callbacks, 'text', seq)
    callbacks?.onStage?.({ stage: 'completed' })
    callbacks?.onComplete?.(parts.text)
    return completion
  } catch (error) {
    callbacks?.onError?.(error, undefined)
    throw error
  }
}
