import OpenAI from 'openai'
import { ApiError } from '@/lib/api-errors'

type SupportedProvider =
  | 'openrouter'
  | 'google'
  | 'anthropic'
  | 'openai'
  | 'bailian'
  | 'siliconflow'
  | 'openai-compatible'
  | 'gemini-compatible'
  | 'anthropic-compatible'
  | 'custom'

type TestConnectionPayload = {
  provider?: string
  apiKey?: string
  baseUrl?: string
  region?: string
  model?: string
}

export type LlmConnectionTestResult = {
  provider: SupportedProvider
  message: string
  model?: string
  answer?: string
}

function normalizeProvider(payload: TestConnectionPayload): SupportedProvider {
  const provider = typeof payload.provider === 'string' ? payload.provider.trim().toLowerCase() : ''
  if (!provider) {
    if (typeof payload.baseUrl === 'string' && payload.baseUrl.trim()) return 'custom'
    throw new ApiError('INVALID_PARAMS', { message: '缺少必要参数 provider' })
  }

  switch (provider) {
    case 'openrouter':
    case 'google':
    case 'anthropic':
    case 'openai':
    case 'openai-compatible':
    case 'gemini-compatible':
    case 'anthropic-compatible':
    case 'bailian':
    case 'siliconflow':
    case 'custom':
      return provider
    default:
      throw new ApiError('INVALID_PARAMS', { message: `不支持的渠道: ${provider}` })
  }
}

function requireApiKey(payload: TestConnectionPayload): string {
  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : ''
  if (!apiKey) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少必要参数 apiKey' })
  }
  return apiKey
}

function requireBaseUrl(payload: TestConnectionPayload): string {
  const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : ''
  if (!baseUrl) {
    throw new ApiError('INVALID_PARAMS', { message: '自定义渠道需要提供 baseUrl' })
  }
  return baseUrl
}

async function testGoogleAI(apiKey: string): Promise<void> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { method: 'GET' },
  )
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Google AI 认证失败: ${error}`)
  }
}

async function testOpenAICompatibleConnection(params: {
  apiKey: string
  baseURL?: string
  model?: string
  defaultHeaders?: Record<string, string>
}): Promise<Pick<LlmConnectionTestResult, 'model' | 'answer'>> {
  const client = new OpenAI({
    apiKey: params.apiKey,
    baseURL: params.baseURL,
    timeout: 30000,
    defaultHeaders: params.defaultHeaders,
  })

  if (params.model) {
    const response = await client.chat.completions.create({
      model: params.model,
      messages: [{ role: 'user', content: '1+1等于几？只回答数字' }],
      max_tokens: 10,
      temperature: 0,
    })
    const answer = response.choices[0]?.message?.content?.trim() || ''
    return {
      model: response.model || params.model,
      answer,
    }
  }

  await client.models.list()
  return {}
}

async function testBailianProbe(apiKey: string): Promise<{ model?: string }> {
  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Bailian probe failed (${response.status}): ${error}`)
  }
  const data = await response.json() as { data?: Array<{ id?: string }> }
  const firstModel = Array.isArray(data.data) ? data.data.find((item) => typeof item.id === 'string')?.id : undefined
  return { model: firstModel }
}

async function testSiliconFlowProbe(apiKey: string): Promise<{ model?: string; answer?: string }> {
  const modelsResponse = await fetch('https://api.siliconflow.cn/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!modelsResponse.ok) {
    const error = await modelsResponse.text()
    throw new Error(`SiliconFlow models probe failed (${modelsResponse.status}): ${error}`)
  }

  const modelData = await modelsResponse.json() as { data?: Array<{ id?: string }> }
  const firstModel = Array.isArray(modelData.data) ? modelData.data.find((item) => typeof item.id === 'string')?.id : undefined

  const userInfoResponse = await fetch('https://api.siliconflow.cn/v1/user/info', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!userInfoResponse.ok) {
    const error = await userInfoResponse.text()
    throw new Error(`SiliconFlow user info probe failed (${userInfoResponse.status}): ${error}`)
  }
  const info = await userInfoResponse.json() as { balance?: unknown; data?: { balance?: unknown } }
  const rawBalance = info.balance ?? info.data?.balance
  const balance = typeof rawBalance === 'number'
    ? String(rawBalance)
    : typeof rawBalance === 'string' && rawBalance.trim()
      ? rawBalance.trim()
      : undefined

  return {
    model: firstModel,
    answer: typeof balance === 'string' ? `balance=${balance}` : 'userinfo_ok',
  }
}

function normalizeAnthropicBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function extractAnthropicAnswer(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
  const content = (payload as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        return (part as { text: string }).text
      }
      return ''
    })
    .join('')
    .trim()
}

async function testAnthropicCompatibleConnection(params: {
  apiKey: string
  baseURL: string
  model?: string
}): Promise<Pick<LlmConnectionTestResult, 'model' | 'answer'>> {
  const model = params.model || 'claude-sonnet-4-6'
  const response = await fetch(`${normalizeAnthropicBaseUrl(params.baseURL)}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      Authorization: `Bearer ${params.apiKey}`,
      'x-api-key': params.apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 10,
      temperature: 0,
      messages: [{ role: 'user', content: '1+1等于几？只回答数字' }],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const bodyText = await response.text().catch(() => '')
  if (!response.ok) {
    throw new Error(`Anthropic-compatible probe failed (${response.status}): ${bodyText}`)
  }
  let parsed: unknown = null
  try {
    parsed = bodyText ? JSON.parse(bodyText) as unknown : null
  } catch {
    parsed = null
  }
  return {
    model,
    answer: extractAnthropicAnswer(parsed),
  }
}

export async function testLlmConnection(payload: TestConnectionPayload): Promise<LlmConnectionTestResult> {
  const provider = normalizeProvider(payload)
  const apiKey = requireApiKey(payload)
  const requestedModel = typeof payload.model === 'string' ? payload.model.trim() : ''

  switch (provider) {
    case 'openrouter': {
      const tested = await testOpenAICompatibleConnection({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        model: requestedModel || undefined,
      })
      return { provider, message: 'openrouter 连接成功', ...tested }
    }
    case 'google':
      await testGoogleAI(apiKey)
      return { provider, message: 'google 连接成功' }
    case 'anthropic': {
      const tested = await testOpenAICompatibleConnection({
        apiKey,
        baseURL: 'https://api.anthropic.com/v1',
        model: requestedModel || 'claude-3-haiku-20240307',
        defaultHeaders: { 'anthropic-version': '2023-06-01' },
      })
      return { provider, message: 'anthropic 连接成功', ...tested }
    }
    case 'openai': {
      const tested = await testOpenAICompatibleConnection({
        apiKey,
        model: requestedModel || undefined,
      })
      return { provider, message: 'openai 连接成功', ...tested }
    }
    case 'bailian': {
      const tested = await testBailianProbe(apiKey)
      return { provider, message: 'bailian 连接成功', ...tested }
    }
    case 'siliconflow': {
      const tested = await testSiliconFlowProbe(apiKey)
      return { provider, message: 'siliconflow 连接成功', ...tested }
    }
    case 'openai-compatible': {
      const tested = await testOpenAICompatibleConnection({
        apiKey,
        baseURL: requireBaseUrl(payload),
        model: requestedModel || undefined,
      })
      return { provider, message: 'openai-compatible 连接成功', ...tested }
    }
    case 'gemini-compatible': {
      const tested = await testOpenAICompatibleConnection({
        apiKey,
        baseURL: requireBaseUrl(payload),
        model: requestedModel || undefined,
      })
      return { provider, message: 'gemini-compatible 连接成功', ...tested }
    }
    case 'anthropic-compatible': {
      const tested = await testAnthropicCompatibleConnection({
        apiKey,
        baseURL: requireBaseUrl(payload),
        model: requestedModel || undefined,
      })
      return { provider, message: 'anthropic-compatible 连接成功', ...tested }
    }
    case 'custom': {
      const tested = await testOpenAICompatibleConnection({
        apiKey,
        baseURL: requireBaseUrl(payload),
        model: requestedModel || undefined,
      })
      return { provider, message: 'custom 连接成功', ...tested }
    }
  }
}
