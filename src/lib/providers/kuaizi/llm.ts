import type OpenAI from 'openai'
import { getKuaiziModelDefinition } from './catalog'
import { asRecord, postKuaiziApiKey } from './client'
import type { KuaiziLlmMessage } from './types'

export interface KuaiziLlmCompletionParams {
  modelId: string
  messages: KuaiziLlmMessage[]
  apiKey: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
}

export async function completeKuaiziLlm(
  params: KuaiziLlmCompletionParams,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  getKuaiziModelDefinition(params.modelId, 'llm')
  const payload = await postKuaiziApiKey({
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
    path: '/ai-open-platform-api/v1/chat/completions',
    body: {
      model: params.modelId,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      ...(typeof params.maxTokens === 'number' ? { max_tokens: params.maxTokens } : {}),
    },
  })
  const record = asRecord(payload)
  if (!record || !Array.isArray(record.choices)) {
    throw new Error('KUAIZI_LLM_RESPONSE_INVALID')
  }
  return payload as unknown as OpenAI.Chat.Completions.ChatCompletion
}
