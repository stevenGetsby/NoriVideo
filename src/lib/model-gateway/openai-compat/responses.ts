import { buildOpenAIChatCompletion } from '@/lib/llm/providers/openai-compat'
import { buildReasoningAwareContent } from '@/lib/llm/utils'
import type { OpenAICompatChatRequest } from '../types'
import { resolveOpenAICompatClientConfig } from './common'

type ResponsesUsage = {
  promptTokens: number
  completionTokens: number
}

type ErrorWithStatus = Error & { status?: number }

const OPENAI_COMPAT_RESPONSE_TIMEOUT_MS = 300_000
const temperatureUnsupportedModels = new Set<string>()

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function toEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function temperatureCapabilityKey(providerId: string, modelId: string) {
  return `${providerId.trim().toLowerCase()}::${modelId.trim().toLowerCase()}`
}

function isUnsupportedTemperatureResponse(status: number, body: string) {
  if (status !== 400) return false
  const normalized = body.toLowerCase()
  return normalized.includes('temperature') && (
    normalized.includes('unsupported parameter')
    || normalized.includes('not supported')
    || normalized.includes('unknown parameter')
  )
}

async function postResponses(params: {
  endpoint: string
  apiKey: string
  body: Record<string, unknown>
}) {
  return await fetch(params.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(params.body),
    signal: AbortSignal.timeout(OPENAI_COMPAT_RESPONSE_TIMEOUT_MS),
  })
}

function collectText(node: unknown, acc: string[]) {
  if (typeof node === 'string') {
    acc.push(node)
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectText(item, acc))
    return
  }
  const record = asRecord(node)
  if (!record) return

  const type = typeof record.type === 'string' ? record.type : ''
  if (type.includes('reasoning')) return
  if (typeof record.output_text === 'string') acc.push(record.output_text)
  if (typeof record.text === 'string') acc.push(record.text)
  if (typeof record.content === 'string') acc.push(record.content)
  if (record.content !== undefined && typeof record.content !== 'string') collectText(record.content, acc)
  if (record.output !== undefined) collectText(record.output, acc)
}

function collectReasoning(node: unknown, acc: string[]) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectReasoning(item, acc))
    return
  }
  const record = asRecord(node)
  if (!record) return

  const type = typeof record.type === 'string' ? record.type : ''
  if (type.includes('reasoning')) {
    if (typeof record.text === 'string') acc.push(record.text)
    if (typeof record.content === 'string') acc.push(record.content)
    if (record.content !== undefined && typeof record.content !== 'string') {
      collectReasoning(record.content, acc)
    }
  }

  if (record.reasoning !== undefined) collectReasoning(record.reasoning, acc)
  if (record.reasoning_content !== undefined) collectReasoning(record.reasoning_content, acc)
  if (record.output !== undefined) collectReasoning(record.output, acc)
}

function extractResponsesText(payload: unknown): string {
  const root = asRecord(payload)
  if (!root) return ''
  if (typeof root.output_text === 'string') return root.output_text

  const parts: string[] = []
  collectText(root.output ?? root, parts)
  return parts.join('')
}

function extractResponsesReasoning(payload: unknown): string {
  const root = asRecord(payload)
  if (!root) return ''

  const parts: string[] = []
  collectReasoning(root.output ?? root, parts)
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

export async function runOpenAICompatResponsesCompletion(input: OpenAICompatChatRequest) {
  const config = await resolveOpenAICompatClientConfig(input.userId, input.providerId)
  const endpoint = toEndpoint(config.baseUrl, '/responses')
  const capabilityKey = temperatureCapabilityKey(config.providerId, input.modelId)
  const baseBody = {
    model: input.modelId,
    input: input.messages.map((message) => ({
      role: message.role,
      content: [{ type: 'input_text', text: message.content }],
    })),
  }
  const includeTemperature = !temperatureUnsupportedModels.has(capabilityKey)
  let response = await postResponses({
    endpoint,
    apiKey: config.apiKey,
    body: includeTemperature
      ? { ...baseBody, temperature: input.temperature }
      : baseBody,
  })

  if (!response.ok) {
    let errorBody = await response.text().catch(() => '')
    if (includeTemperature && isUnsupportedTemperatureResponse(response.status, errorBody)) {
      temperatureUnsupportedModels.add(capabilityKey)
      response = await postResponses({
        endpoint,
        apiKey: config.apiKey,
        body: baseBody,
      })
      if (response.ok) {
        errorBody = ''
      } else {
        errorBody = await response.text().catch(() => '')
      }
    }
    if (response.ok) {
      const payload = await response.json() as unknown
      const text = extractResponsesText(payload)
      const reasoning = extractResponsesReasoning(payload)
      const usage = extractResponsesUsage(payload)

      return buildOpenAIChatCompletion(
        input.modelId,
        buildReasoningAwareContent(text, reasoning),
        usage,
      )
    }
    const error = new Error(
      `OPENAI_COMPAT_RESPONSES_FAILED: ${response.status} ${errorBody.slice(0, 300)}`,
    ) as ErrorWithStatus
    error.status = response.status
    throw error
  }

  const payload = await response.json() as unknown
  const text = extractResponsesText(payload)
  const reasoning = extractResponsesReasoning(payload)
  const usage = extractResponsesUsage(payload)

  return buildOpenAIChatCompletion(
    input.modelId,
    buildReasoningAwareContent(text, reasoning),
    usage,
  )
}
