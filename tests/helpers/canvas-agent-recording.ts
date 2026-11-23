import { z } from 'zod'

export const CANVAS_RECORDING_MAX_BYTES = 512 * 1024
const modelId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/)
const segment = z.object({
  reportedModelId: modelId,
  stream: z.string().min(1).max(250_000).refine((value) => /^data:/m.test(value)),
}).strict()
const envelope = z.object({
  source: z.literal('provider-capture'),
  providerId: z.enum(['deepseek', 'kimi', 'openai']),
  modelId,
  first: segment,
  followUp: segment,
}).strict()

export function parseCanvasAgentRecording(raw: string): z.output<typeof envelope> {
  try {
    if (Buffer.byteLength(raw, 'utf8') > CANVAS_RECORDING_MAX_BYTES) throw new Error()
    const capture = envelope.parse(JSON.parse(raw))
    for (const { stream } of [capture.first, capture.followUp]) {
      if (/\b(?:authorization|set-cookie|x-api-key)\s*["'\\]*\s*:|\bBearer\s+[\w.-]{8,}|\bsk-[a-z0-9_-]{10,}/i.test(stream)) throw new Error()
    }
    return capture
  } catch {
    // Do not print any bytes from an untrusted capture, including on failure.
    throw new Error('脱敏录制格式不合法或包含疑似凭据')
  }
}
