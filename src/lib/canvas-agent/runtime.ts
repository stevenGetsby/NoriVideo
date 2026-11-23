import { safeValidateUIMessages, stepCountIs, streamText, type InferUITools, type UIDataTypes, type UIMessage } from 'ai'
import { ApiError } from '@/lib/api-errors'
import { toModelMessages } from '@/lib/assistant-platform/messages'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import type { readCanvasAgentChatBody } from './chat-request'
import { formatCanvasAgentDigest } from './context-schema'
import { createCanvasAgentFakeModel } from './fake-model'
import { CanvasAgentModelSelectionError } from './model-catalog'
import { resolveCanvasAgentLanguageModel } from './model-runtime'
import { prepareCanvasAgentStreamBilling } from './stream-billing'
import { saveCanvasAgentThread } from './threads'
import { canvasAgentTools } from './tools'

type CanvasAgentUIMessage = UIMessage<unknown, UIDataTypes, InferUITools<typeof canvasAgentTools>>

type ChatInput = Awaited<ReturnType<typeof readCanvasAgentChatBody>> & {
  userId: string
  projectId: string
  canvasId: string
  signal: AbortSignal
}

function modelWindow(messages: UIMessage[]) {
  const window = messages.slice(-24)
  return window.map((message, index) => {
    if (index >= window.length - 8) return message
    return {
      ...message,
      parts: message.parts.map((part) => 'state' in part && part.state === 'output-available'
        ? { ...part, output: { omitted: true } }
        : part),
    }
  })
}

export async function createCanvasAgentChatResponse({ messages, context, userId, projectId, canvasId, threadId, signal }: ChatInput): Promise<Response> {
  const validation = await safeValidateUIMessages<CanvasAgentUIMessage>({ messages, tools: canvasAgentTools })
  if (!validation.success) throw new ApiError('INVALID_PARAMS', { message: '喵导对话消息无效。' })
  // The canvas context and the model tools are text-only. In particular no
  // client-supplied system instructions or remote file parts may reach the
  // SDK's provider transport.
  if (validation.data.some((message) => message.role === 'system' || message.parts.some((part) => (
    message.role === 'user' ? part.type !== 'text'
      : !['text', 'reasoning', 'step-start'].includes(part.type) && !part.type.startsWith('tool-')
  )))) throw new ApiError('INVALID_PARAMS', { message: '喵导对话只支持文本和已登记的工具结果。' })
  const displayMessages = validation.data.map((message) => ({
    ...message, parts: message.parts.filter((part) => part.type !== 'reasoning'),
  }))
  const fixture = createCanvasAgentFakeModel(displayMessages, context.digest)
  const resolved = fixture ? null : await resolveCanvasAgentLanguageModel({
    userId, requestedModelKey: context.modelKey,
  }).catch((error: unknown) => {
    if (error instanceof CanvasAgentModelSelectionError) {
      throw new ApiError('INVALID_PARAMS', { code: error.code, message: '所选喵导模型尚不可用。' })
    }
    throw new ApiError('EXTERNAL_ERROR', { code: 'CANVAS_AGENT_STREAM_FAILED' })
  })

  const autonomy = context.autonomy === 'auto_budget'
    ? `Auto budget mode (${context.budgetPoints ?? 10} points; this does not authorize a charge).`
    : 'Costly actions require user confirmation.'
  const prompt = buildPrompt({ promptId: PROMPT_IDS.CANVAS_AGENT_SYSTEM, locale: context.locale })
  const system = `${prompt}\n\n${autonomy}\n\n${formatCanvasAgentDigest(context.digest)}`
  const modelMessages = await toModelMessages(modelWindow(displayMessages))
  // Estimate conservatively in bytes, including the registered tools and
  // overhead. Never silently clamp the reserve below the submitted context.
  const inputReserve = Math.max(4_000, new TextEncoder().encode(
    system + JSON.stringify(modelMessages) + JSON.stringify(Object.keys(canvasAgentTools)),
  ).byteLength + 8_192)
  if (inputReserve > 256_000) throw new ApiError('INVALID_PARAMS', { message: '本轮画布对话过长，请新建对话或缩短输入。' })
  const billing = resolved ? await prepareCanvasAgentStreamBilling({
    userId, projectId, canvasId, threadId, turnIndex: context.turnIndex,
    modelKey: resolved.modelKey, providerId: resolved.providerId,
    maxInputTokens: inputReserve,
  }) : null
  try {
    const result = streamText({
      model: fixture ?? resolved!.languageModel,
      system,
      tools: canvasAgentTools,
      messages: modelMessages,
      stopWhen: stepCountIs(4),
      ...(resolved?.supportsTemperature ? { temperature: 0.3 } : {}),
      maxOutputTokens: 4096,
      maxRetries: 0,
      abortSignal: signal,
      onFinish: async ({ totalUsage }) => { await billing?.settle(totalUsage) },
      onError: async () => { await billing?.rollback('CANVAS_AGENT_STREAM_FAILED') },
      onAbort: async () => { await billing?.rollback('CANVAS_AGENT_STREAM_ABORTED') },
    })

    return result.toUIMessageStreamResponse({
      originalMessages: displayMessages,
      sendReasoning: false,
      headers: { 'Cache-Control': 'no-store' },
      onError: () => 'CANVAS_AGENT_STREAM_FAILED',
      onFinish: async ({ messages: updated, isAborted }) => {
        if (isAborted) {
          await billing?.rollback('CANVAS_AGENT_STREAM_ABORTED')
          return
        }
        const displayMessages = updated.map((message) => ({
          ...message, parts: message.parts.filter((part: UIMessage['parts'][number]) => part.type !== 'reasoning'),
        }))
        await saveCanvasAgentThread({ threadId, userId, projectId, canvasId, messages: displayMessages }).catch(() => {
          console.warn('[canvas-agent] THREAD_SAVE_FAILED')
        })
      },
    })
  } catch {
    await billing?.rollback('CANVAS_AGENT_STREAM_FAILED')
    throw new ApiError('EXTERNAL_ERROR', { code: 'CANVAS_AGENT_STREAM_FAILED' })
  }
}
