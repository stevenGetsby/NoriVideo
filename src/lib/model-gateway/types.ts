export type ModelGatewayRoute = 'official' | 'openai-compat'

export type CompatibleProviderKey = 'openlux'

export interface OpenAICompatClientConfig {
  providerId: string
  baseUrl: string
  apiKey: string
}

export type OpenAICompatMessageContent =
  | string
  | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >

export interface OpenAICompatChatRequest {
  userId: string
  providerId: string
  modelId: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: OpenAICompatMessageContent }>
  temperature: number
}
