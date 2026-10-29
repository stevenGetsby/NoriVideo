import OpenAI from 'openai'
import type { ChatCompletionStreamCallbacks } from '@/lib/llm/types'
import type { InternalLLMStreamStepMeta } from '@/lib/llm-observe/internal-stream-context'
import { buildOpenAIChatCompletion } from '@/lib/llm/providers/openai-compat'
import { buildReasoningAwareContent, extractStreamDeltaParts } from '@/lib/llm/utils'
import { withStreamChunkTimeout } from '@/lib/llm/stream-timeout'
import { emitStreamChunk } from '@/lib/llm/stream-helpers'
import type { OpenAICompatChatRequest } from '../types'
import { createOpenAICompatClient, resolveOpenAICompatClientConfig } from './common'

export async function runOpenAICompatChatCompletion(input: OpenAICompatChatRequest): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const config = await resolveOpenAICompatClientConfig(input.userId, input.providerId)
  const client = createOpenAICompatClient(config)
  return await client.chat.completions.create({
    model: input.modelId,
    messages: input.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: input.temperature,
  })
}

type OpenAIStreamWithFinal = AsyncIterable<unknown> & {
  finalChatCompletion?: () => Promise<OpenAI.Chat.Completions.ChatCompletion>
}

export async function runOpenAICompatChatCompletionStream(
  input: OpenAICompatChatRequest,
  callbacks?: ChatCompletionStreamCallbacks,
  stepMeta?: InternalLLMStreamStepMeta,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const config = await resolveOpenAICompatClientConfig(input.userId, input.providerId)
  const client = createOpenAICompatClient(config)
  const stream = await client.chat.completions.create({
    model: input.modelId,
    messages: input.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: input.temperature,
    stream: true,
    stream_options: { include_usage: true },
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming)

  let text = ''
  let reasoning = ''
  let seq = 1
  let finalCompletion: OpenAI.Chat.Completions.ChatCompletion | null = null
  let streamedUsage: OpenAI.Chat.Completions.ChatCompletion['usage']

  for await (const part of withStreamChunkTimeout(stream as AsyncIterable<unknown>)) {
    const usage = (part as { usage?: OpenAI.Chat.Completions.ChatCompletion['usage'] }).usage
    if (usage) streamedUsage = usage
    const { textDelta, reasoningDelta } = extractStreamDeltaParts(part)
    if (reasoningDelta) {
      reasoning += reasoningDelta
      emitStreamChunk(callbacks, stepMeta, {
        kind: 'reasoning',
        delta: reasoningDelta,
        seq,
        lane: 'reasoning',
      })
      seq += 1
    }
    if (textDelta) {
      text += textDelta
      emitStreamChunk(callbacks, stepMeta, {
        kind: 'text',
        delta: textDelta,
        seq,
        lane: 'main',
      })
      seq += 1
    }
  }

  const finalChatCompletionFn = (stream as OpenAIStreamWithFinal).finalChatCompletion
  if (typeof finalChatCompletionFn === 'function') {
    try {
      finalCompletion = await finalChatCompletionFn.call(stream)
    } catch {
      finalCompletion = null
    }
  }

  if (finalCompletion && reasoning && finalCompletion.choices[0]?.message) {
    finalCompletion.choices[0].message.content = buildReasoningAwareContent(text, reasoning) as string
  }

  const completion = finalCompletion || buildOpenAIChatCompletion(
    input.modelId,
    buildReasoningAwareContent(text, reasoning),
    streamedUsage ? {
      promptTokens: streamedUsage.prompt_tokens,
      completionTokens: streamedUsage.completion_tokens,
    } : undefined,
  )

  return completion
}
