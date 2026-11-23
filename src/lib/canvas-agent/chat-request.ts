import { ApiError } from '@/lib/api-errors'
import { checkRateLimit } from '@/lib/rate-limit'
import { chatBodySchema } from './context-schema'
import { assertCanvasAgentModeSupported } from './project-scope'

const MAX_CHAT_REQUEST_BYTES = 3 * 1024 * 1024

export async function enforceCanvasAgentRateLimit(userId: string) {
  for (const [action, config] of [
    ['canvas-agent', { windowSeconds: 60, maxRequests: 30 }],
    ['canvas-agent-day', { windowSeconds: 86_400, maxRequests: 600 }],
  ] as const) {
    const result = await checkRateLimit(action, userId, config)
    if (result.limited) throw new ApiError('RATE_LIMIT', { retryAfterSeconds: result.retryAfterSeconds })
  }
}

export async function readCanvasAgentChatBody(request: Request) {
  const tooLarge = () => new ApiError('INVALID_PARAMS', { message: '喵导请求不能超过 3 MiB。' })
  if (Number(request.headers.get('content-length')) > MAX_CHAT_REQUEST_BYTES) throw tooLarge()
  const reader = request.body?.getReader()
  if (!reader) throw new ApiError('INVALID_PARAMS', { message: '缺少喵导请求内容。' })
  const decoder = new TextDecoder()
  let raw = ''
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_CHAT_REQUEST_BYTES) {
        void reader.cancel().catch(() => undefined)
        throw tooLarge()
      }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  let body: unknown
  try { body = JSON.parse(raw) } catch {
    throw new ApiError('INVALID_PARAMS', { message: '喵导请求不是有效的 JSON。' })
  }
  const validated = chatBodySchema.safeParse(body)
  if (!validated.success) throw new ApiError('INVALID_PARAMS', { message: '喵导请求格式不正确。' })
  assertCanvasAgentModeSupported(validated.data.context.mode)
  if (validated.data.context.turnIndex >= 8) throw new ApiError('INVALID_PARAMS', { message: '本轮对话已达到执行上限。' })
  return validated.data
}
