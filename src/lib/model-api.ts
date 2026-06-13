import type OpenAI from 'openai'
import { chatCompletion } from '@/lib/llm/chat-completion'
import { chatCompletionWithVision } from '@/lib/llm/vision'
import type { ChatCompletionOptions } from '@/lib/llm/types'
import { generateImage, generateVideo } from '@/lib/generator-api'
import type { GenerateResult } from '@/lib/generators/base'

export type ModelApiKind = 'text' | 'vision' | 'image' | 'video'

export type TextModelApiInput = {
  kind: 'text'
  userId: string
  modelKey: string | null | undefined
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  options?: ChatCompletionOptions
}

export type VisionModelApiInput = {
  kind: 'vision'
  userId: string
  modelKey: string | null | undefined
  prompt: string
  imageUrls?: string[]
  options?: ChatCompletionOptions
}

export type ImageModelApiInput = {
  kind: 'image'
  userId: string
  modelKey: string
  prompt: string
  options?: Parameters<typeof generateImage>[3]
}

export type VideoModelApiInput = {
  kind: 'video'
  userId: string
  modelKey: string
  imageUrl: string
  options?: Parameters<typeof generateVideo>[3]
}

export type ModelApiInput =
  | TextModelApiInput
  | VisionModelApiInput
  | ImageModelApiInput
  | VideoModelApiInput

export type ModelApiResult<T extends ModelApiInput> =
  T['kind'] extends 'text'
    ? OpenAI.Chat.Completions.ChatCompletion
    : T['kind'] extends 'vision'
      ? OpenAI.Chat.Completions.ChatCompletion
      : GenerateResult

export async function callTextModel(
  input: Omit<TextModelApiInput, 'kind'>,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return await chatCompletion(
    input.userId,
    input.modelKey,
    input.messages,
    input.options,
  )
}

export async function callVisionModel(
  input: Omit<VisionModelApiInput, 'kind'>,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return await chatCompletionWithVision(
    input.userId,
    input.modelKey,
    input.prompt,
    input.imageUrls || [],
    input.options,
  )
}

export async function callImageModel(
  input: Omit<ImageModelApiInput, 'kind'>,
): Promise<GenerateResult> {
  return await generateImage(
    input.userId,
    input.modelKey,
    input.prompt,
    input.options,
  )
}

export async function callVideoModel(
  input: Omit<VideoModelApiInput, 'kind'>,
): Promise<GenerateResult> {
  return await generateVideo(
    input.userId,
    input.modelKey,
    input.imageUrl,
    input.options,
  )
}

export async function callModelApi<T extends ModelApiInput>(
  input: T,
): Promise<ModelApiResult<T>> {
  switch (input.kind) {
    case 'text':
      return await callTextModel(input) as ModelApiResult<T>
    case 'vision':
      return await callVisionModel(input) as ModelApiResult<T>
    case 'image':
      return await callImageModel(input) as ModelApiResult<T>
    case 'video':
      return await callVideoModel(input) as ModelApiResult<T>
    default: {
      const neverInput: never = input
      throw new Error(`MODEL_API_KIND_UNSUPPORTED: ${(neverInput as { kind?: string }).kind}`)
    }
  }
}
