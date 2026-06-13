import { buildOpenAIChatCompletion } from './openai-compat'

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }

type AnthropicImageInput = {
  mediaType: string
  data: string
}

type AnthropicRequestContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

type AnthropicContentBlock =
  | { type?: string; text?: string }
  | string

type AnthropicMessageResponse = {
  id?: string
  model?: string
  content?: AnthropicContentBlock[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

type AnthropicStreamEvent = {
  type?: string
  message?: {
    usage?: {
      input_tokens?: number
      output_tokens?: number
    }
  }
  delta?: {
    type?: string
    text?: string
    thinking?: string
    stop_reason?: string
  }
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

type AnthropicUsage = {
  promptTokens: number
  completionTokens: number
}

function normalizeAnthropicBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function buildAnthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    Authorization: `Bearer ${apiKey}`,
    'x-api-key': apiKey,
  }
}

function mapMessages(messages: ChatMessage[]): {
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
} {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .filter(Boolean)
    .join('\n')
  const conversation = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: message.content,
    }))

  return {
    ...(system ? { system } : {}),
    messages: conversation.length > 0 ? conversation : [{ role: 'user', content: '' }],
  }
}

function extractText(response: AnthropicMessageResponse): string {
  const content = Array.isArray(response.content) ? response.content : []
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof part.text === 'string') return part.text
      return ''
    })
    .join('')
}

function toUsage(usage?: AnthropicMessageResponse['usage'] | AnthropicStreamEvent['usage']): AnthropicUsage {
  const promptTokens = Number(usage?.input_tokens ?? 0)
  const completionTokens = Number(usage?.output_tokens ?? 0)
  return {
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
  }
}

async function readError(response: Response): Promise<Error> {
  const body = await response.text().catch(() => '')
  let message = body || `Anthropic-compatible request failed (${response.status})`
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    message = parsed.error?.message || parsed.message || message
  } catch {
    // keep raw body
  }
  const error = new Error(message)
  ;(error as Error & { status?: number }).status = response.status
  return error
}

function buildBody(input: {
  modelId: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
}) {
  const mapped = mapMessages(input.messages)
  return {
    model: input.modelId,
    max_tokens: input.maxTokens ?? 4096,
    temperature: input.temperature ?? 0.7,
    stream: input.stream === true,
    ...mapped,
  }
}

function buildVisionBody(input: {
  modelId: string
  prompt: string
  images: AnthropicImageInput[]
  temperature?: number
  maxTokens?: number
}) {
  const content: AnthropicRequestContentBlock[] = [
    ...input.images.map((image) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mediaType,
        data: image.data,
      },
    })),
  ]
  const prompt = input.prompt.trim() || 'analyze vision content'
  content.push({ type: 'text', text: prompt })

  return {
    model: input.modelId,
    max_tokens: input.maxTokens ?? 4096,
    temperature: input.temperature ?? 0.7,
    messages: [{ role: 'user', content }],
  }
}

export async function completeAnthropicCompatibleLlm(input: {
  modelId: string
  messages: ChatMessage[]
  apiKey: string
  baseUrl: string
  temperature?: number
  maxTokens?: number
}) {
  const endpoint = `${normalizeAnthropicBaseUrl(input.baseUrl)}/messages`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildAnthropicHeaders(input.apiKey),
    body: JSON.stringify(buildBody(input)),
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    throw await readError(response)
  }

  const payload = await response.json() as AnthropicMessageResponse
  return buildOpenAIChatCompletion(
    payload.model || input.modelId,
    extractText(payload),
    toUsage(payload.usage),
  )
}

export async function completeAnthropicCompatibleVisionLlm(input: {
  modelId: string
  prompt: string
  images: AnthropicImageInput[]
  apiKey: string
  baseUrl: string
  temperature?: number
  maxTokens?: number
}) {
  const endpoint = `${normalizeAnthropicBaseUrl(input.baseUrl)}/messages`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildAnthropicHeaders(input.apiKey),
    body: JSON.stringify(buildVisionBody(input)),
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    throw await readError(response)
  }

  const payload = await response.json() as AnthropicMessageResponse
  return buildOpenAIChatCompletion(
    payload.model || input.modelId,
    extractText(payload),
    toUsage(payload.usage),
  )
}

function parseSseData(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const rest = parts.pop() || ''
  const events = parts
    .map((part) => part
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n'))
    .filter(Boolean)
  return { events, rest }
}

export async function streamAnthropicCompatibleLlm(input: {
  modelId: string
  messages: ChatMessage[]
  apiKey: string
  baseUrl: string
  temperature?: number
  maxTokens?: number
  onTextDelta?: (delta: string) => void
  onReasoningDelta?: (delta: string) => void
}) {
  const endpoint = `${normalizeAnthropicBaseUrl(input.baseUrl)}/messages`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildAnthropicHeaders(input.apiKey),
    body: JSON.stringify(buildBody({ ...input, stream: true })),
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    throw await readError(response)
  }
  if (!response.body) {
    throw new Error('ANTHROPIC_COMPAT_STREAM_EMPTY_BODY')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let reasoning = ''
  let usage: AnthropicUsage = { promptTokens: 0, completionTokens: 0 }

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const parsed = parseSseData(buffer)
    buffer = parsed.rest

    for (const eventText of parsed.events) {
      if (eventText === '[DONE]') continue
      let event: AnthropicStreamEvent
      try {
        event = JSON.parse(eventText) as AnthropicStreamEvent
      } catch {
        continue
      }
      if (event.type === 'message_start' && event.message?.usage) {
        usage = toUsage(event.message.usage)
      }
      if (event.type === 'content_block_delta' && event.delta) {
        if (typeof event.delta.text === 'string' && event.delta.text) {
          text += event.delta.text
          input.onTextDelta?.(event.delta.text)
        }
        if (typeof event.delta.thinking === 'string' && event.delta.thinking) {
          reasoning += event.delta.thinking
          input.onReasoningDelta?.(event.delta.thinking)
        }
      }
      if (event.type === 'message_delta' && event.usage) {
        const deltaUsage = toUsage(event.usage)
        usage = {
          promptTokens: usage.promptTokens || deltaUsage.promptTokens,
          completionTokens: deltaUsage.completionTokens || usage.completionTokens,
        }
      }
    }
  }

  const tail = decoder.decode()
  if (tail) {
    const parsed = parseSseData(buffer + tail)
    for (const eventText of parsed.events) {
      if (eventText === '[DONE]') continue
      try {
        const event = JSON.parse(eventText) as AnthropicStreamEvent
        if (event.type === 'content_block_delta' && typeof event.delta?.text === 'string') {
          text += event.delta.text
          input.onTextDelta?.(event.delta.text)
        }
      } catch {
        // ignore trailing malformed chunks
      }
    }
  }

  return buildOpenAIChatCompletion(
    input.modelId,
    reasoning ? `<reasoning>${reasoning}</reasoning>\n${text}` : text,
    usage,
  )
}
