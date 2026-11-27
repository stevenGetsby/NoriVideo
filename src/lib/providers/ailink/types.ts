export type AilinkVideoModelId = 'doubao-seedance-2-5' | 'doubao-seedance-2-5-flash'

export interface AilinkGenerateRequestOptions {
  provider: string
  modelId: string
  modelKey: string
  [key: string]: unknown
}
