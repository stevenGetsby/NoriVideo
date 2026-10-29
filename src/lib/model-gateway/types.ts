export type ModelGatewayRoute = 'official' | 'openai-compat'

export type CompatibleProviderKey = 'deepseek'


export interface OpenAICompatClientConfig {
  providerId: string
  baseUrl: string
  apiKey: string
}

export interface OpenAICompatChatRequest {
  userId: string
  providerId: string
  modelId: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  temperature: number
}
