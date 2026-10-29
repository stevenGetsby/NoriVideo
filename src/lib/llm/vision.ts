import OpenAI from 'openai'
import { getProviderKey } from '../api-config'
import { getInternalLLMStreamCallbacks } from '../llm-observe/internal-stream-context'
import type { ChatCompletionOptions, ChatCompletionStreamCallbacks } from './types'
import { emitChunkedText } from './stream-helpers'
import { getCompletionParts } from './completion-parts'
import { _ulogError, resolveLlmRuntimeModel } from './runtime-shared'

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
  const providerKey = getProviderKey(selection.provider).toLowerCase()
  if (providerKey !== 'deepseek') {
    throw new Error(`TEXT_PROVIDER_UNSUPPORTED: 文本生成仅支持 DeepSeek 官方 API (${selection.provider})`)
  }
  throw new Error('VISION_NOT_SUPPORTED: DeepSeek 官方文本模型不支持图片理解，请改用文字描述')
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
