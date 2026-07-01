import OpenAI from 'openai'
import type { ChatCompletionOptions, ChatCompletionStreamCallbacks, ChatMessage } from './types'
import { buildOpenAIChatCompletion } from './providers/openai-compat'
import { getCompletionParts } from './completion-parts'
import { emitStreamChunk, emitStreamStage, resolveStreamStepMeta } from './stream-helpers'
import { buildReasoningAwareContent, extractStreamDeltaParts } from './utils'
import { withStreamChunkTimeout } from './stream-timeout'
import {
  DEV_TEXT_LLM_PROVIDER,
  getTextLlmRuntimeInfo,
  isDevelopmentTextLlmRuntime,
  readDevelopmentTextLlmConfig,
  resolveTextLlmRuntime,
  type DevelopmentTextLlmConfig,
} from './mode-config'

type OpenAIStreamWithFinal = AsyncIterable<unknown> & {
  finalChatCompletion?: () => Promise<OpenAI.Chat.Completions.ChatCompletion>
}

function shouldUseDevTextLlmStreaming(config: DevelopmentTextLlmConfig): boolean {
  return config.stream
}

export function isDevTextLlmEnabled(): boolean {
  return isDevelopmentTextLlmRuntime(resolveTextLlmRuntime())
}

export function getDevTextLlmRuntimeInfo() {
  const runtime = resolveTextLlmRuntime()
  if (isDevelopmentTextLlmRuntime(runtime)) return getTextLlmRuntimeInfo(runtime)
  const config = readDevelopmentTextLlmConfig()
  return getTextLlmRuntimeInfo({
    mode: 'development',
    kind: 'dev-text',
    provider: DEV_TEXT_LLM_PROVIDER,
    modelId: config.model,
    modelKey: `${DEV_TEXT_LLM_PROVIDER}::${config.model}`,
    config,
  })
}

function createDevTextLlmClient(config: DevelopmentTextLlmConfig): OpenAI {
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  })
}

function buildCreateParams(input: {
  config: DevelopmentTextLlmConfig
  messages: ChatMessage[]
  temperature: number
  maxTokens?: number
}) {
  return {
    model: input.config.model,
    messages: input.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: input.temperature,
    ...(typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens)
      ? { max_tokens: Math.max(1, Math.floor(input.maxTokens)) }
      : {}),
  }
}

type ResponsesUsage = {
  promptTokens: number
  completionTokens: number
}

type ErrorWithStatus = Error & { status?: number }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function toEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function collectResponsesText(node: unknown, acc: string[]) {
  if (typeof node === 'string') {
    acc.push(node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectResponsesText(item, acc))
    return
  }
  const record = asRecord(node)
  if (!record) return

  const type = typeof record.type === 'string' ? record.type : ''
  if (type.includes('reasoning')) return
  if (typeof record.output_text === 'string') acc.push(record.output_text)
  if (typeof record.text === 'string') acc.push(record.text)
  if (typeof record.content === 'string') acc.push(record.content)
  if (record.content !== undefined && typeof record.content !== 'string') {
    collectResponsesText(record.content, acc)
  }
  if (record.output !== undefined) collectResponsesText(record.output, acc)
}

function collectResponsesReasoning(node: unknown, acc: string[]) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectResponsesReasoning(item, acc))
    return
  }
  const record = asRecord(node)
  if (!record) return

  const type = typeof record.type === 'string' ? record.type : ''
  if (type.includes('reasoning')) {
    if (typeof record.text === 'string') acc.push(record.text)
    if (typeof record.content === 'string') acc.push(record.content)
    if (record.content !== undefined && typeof record.content !== 'string') {
      collectResponsesReasoning(record.content, acc)
    }
  }

  if (record.reasoning !== undefined) collectResponsesReasoning(record.reasoning, acc)
  if (record.reasoning_content !== undefined) collectResponsesReasoning(record.reasoning_content, acc)
  if (record.output !== undefined) collectResponsesReasoning(record.output, acc)
}

function extractResponsesText(payload: unknown): string {
  const root = asRecord(payload)
  if (!root) return ''
  if (typeof root.output_text === 'string') return root.output_text

  const parts: string[] = []
  collectResponsesText(root.output ?? root, parts)
  return parts.join('')
}

function extractResponsesReasoning(payload: unknown): string {
  const root = asRecord(payload)
  if (!root) return ''

  const parts: string[] = []
  collectResponsesReasoning(root.output ?? root, parts)
  return parts.join('')
}

function extractResponsesUsage(payload: unknown): ResponsesUsage {
  const usage = asRecord(asRecord(payload)?.usage) || {}
  const promptTokens = typeof usage.input_tokens === 'number'
    ? usage.input_tokens
    : (typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0)
  const completionTokens = typeof usage.output_tokens === 'number'
    ? usage.output_tokens
    : (typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0)
  return {
    promptTokens,
    completionTokens,
  }
}

function buildResponsesInput(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: [{ type: 'input_text', text: message.content }],
  }))
}

async function runDevTextLlmResponsesCompletion(input: {
  config: DevelopmentTextLlmConfig
  messages: ChatMessage[]
  maxTokens?: number
}): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const response = await fetch(toEndpoint(input.config.baseUrl, '/responses'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.config.apiKey}`,
    },
    body: JSON.stringify({
      model: input.config.model,
      input: buildResponsesInput(input.messages),
      ...(typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens)
        ? { max_output_tokens: Math.max(1, Math.floor(input.maxTokens)) }
        : {}),
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    const error = new Error(
      `DEV_TEXT_LLM_RESPONSES_FAILED: ${response.status} ${errorBody.slice(0, 300)}`,
    ) as ErrorWithStatus
    error.status = response.status
    throw error
  }

  const payload = await response.json() as unknown
  const text = extractResponsesText(payload)
  const reasoning = extractResponsesReasoning(payload)
  const usage = extractResponsesUsage(payload)
  return buildOpenAIChatCompletion(
    input.config.model,
    buildReasoningAwareContent(text, reasoning),
    usage,
  )
}

export async function runDevTextLlmCompletion(input: {
  messages: ChatMessage[]
  options?: ChatCompletionOptions
  config?: DevelopmentTextLlmConfig
}): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const config = input.config || readDevelopmentTextLlmConfig()
  if (config.protocol === 'responses') {
    return await runDevTextLlmResponsesCompletion({
      config,
      messages: input.messages,
      maxTokens: input.options?.maxTokens,
    })
  }

  const client = createDevTextLlmClient(config)
  return await client.chat.completions.create(buildCreateParams({
    config,
    messages: input.messages,
    temperature: input.options?.temperature ?? 0.7,
    maxTokens: input.options?.maxTokens,
  }))
}

export async function runDevTextLlmCompletionStream(input: {
  messages: ChatMessage[]
  options?: ChatCompletionOptions
  callbacks?: ChatCompletionStreamCallbacks
  config?: DevelopmentTextLlmConfig
}): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const config = input.config || readDevelopmentTextLlmConfig()
  const streamStep = resolveStreamStepMeta(input.options || {})
  emitStreamStage(input.callbacks, streamStep, 'streaming', DEV_TEXT_LLM_PROVIDER)
  if (config.protocol === 'responses' || !shouldUseDevTextLlmStreaming(config)) {
    const completion = await runDevTextLlmCompletion({
      messages: input.messages,
      options: input.options,
      config,
    })
    const completionParts = getCompletionParts(completion)
    let seq = 1
    if (completionParts.reasoning) {
      emitStreamChunk(input.callbacks, streamStep, {
        kind: 'reasoning',
        delta: completionParts.reasoning,
        seq,
        lane: 'reasoning',
      })
      seq += 1
    }
    if (completionParts.text) {
      emitStreamChunk(input.callbacks, streamStep, {
        kind: 'text',
        delta: completionParts.text,
        seq,
        lane: 'main',
      })
    }
    emitStreamStage(input.callbacks, streamStep, 'completed', DEV_TEXT_LLM_PROVIDER)
    input.callbacks?.onComplete?.(completionParts.text, streamStep)
    return completion
  }

  const client = createDevTextLlmClient(config)

  const stream = await client.chat.completions.create({
    ...buildCreateParams({
      config,
      messages: input.messages,
      temperature: input.options?.temperature ?? 0.7,
      maxTokens: input.options?.maxTokens,
    }),
    stream: true,
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming)

  let text = ''
  let reasoning = ''
  let seq = 1
  let finalCompletion: OpenAI.Chat.Completions.ChatCompletion | null = null

  for await (const chunk of withStreamChunkTimeout(stream as AsyncIterable<unknown>)) {
    const { textDelta, reasoningDelta } = extractStreamDeltaParts(chunk)
    if (reasoningDelta) {
      reasoning += reasoningDelta
      emitStreamChunk(input.callbacks, streamStep, {
        kind: 'reasoning',
        delta: reasoningDelta,
        seq,
        lane: 'reasoning',
      })
      seq += 1
    }
    if (textDelta) {
      text += textDelta
      emitStreamChunk(input.callbacks, streamStep, {
        kind: 'text',
        delta: textDelta,
        seq,
        lane: 'main',
      })
      seq += 1
    }
  }

  const finalChatCompletion = (stream as OpenAIStreamWithFinal).finalChatCompletion
  if (typeof finalChatCompletion === 'function') {
    try {
      finalCompletion = await finalChatCompletion.call(stream)
    } catch {
      finalCompletion = null
    }
  }

  const completion = finalCompletion || buildOpenAIChatCompletion(
    config.model,
    text || reasoning,
    undefined,
  )
  const completionParts = getCompletionParts(completion)
  emitStreamStage(input.callbacks, streamStep, 'completed', DEV_TEXT_LLM_PROVIDER)
  input.callbacks?.onComplete?.(completionParts.text, streamStep)
  return completion
}
