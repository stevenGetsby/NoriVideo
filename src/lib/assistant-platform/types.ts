import type { ToolSet } from 'ai'
export type AssistantId = 'tutorial'

export interface AssistantContext {
  providerId?: string
  locale?: string
}

export interface AssistantResolvedModel {
  providerId: string
  providerKey: string
  modelId: string
}

export interface AssistantRuntimeContext {
  userId: string
  assistantId: AssistantId
  context: AssistantContext
  analysisModelKey: string
  resolvedModel: AssistantResolvedModel
}

export interface AssistantToolResult {
  status: 'saved' | 'invalid' | 'error'
  message: string
  code?: string
}

export interface AssistantSkillDefinition {
  id: AssistantId
  systemPrompt: (ctx: AssistantRuntimeContext) => string
  tools?: (ctx: AssistantRuntimeContext) => ToolSet
  temperature?: number
  maxSteps?: number
}
