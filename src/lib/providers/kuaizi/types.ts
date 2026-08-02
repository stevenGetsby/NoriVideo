export type KuaiziModelModality = 'llm' | 'image' | 'video' | 'audio'

export type KuaiziModelFamily =
  | 'chat'
  | 'gpt-image'
  | 'seedream'
  | 'kling'
  | 'happyhorse'
  | 'seedance'
  | 'seed-audio'
  | 'minimax-tts'

export interface KuaiziModelDefinition {
  modelId: string
  name: string
  modality: KuaiziModelModality
  family: KuaiziModelFamily
}

export interface KuaiziGenerateRequestOptions {
  provider: string
  modelId: string
  modelKey: string
  [key: string]: unknown
}

export interface KuaiziLlmMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}
