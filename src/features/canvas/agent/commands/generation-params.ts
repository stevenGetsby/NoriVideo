import type { z } from 'zod'
import {
  normalizeCanvasImageGenerationOptions,
  normalizeCanvasVideoGenerationOptions,
} from '@/lib/canvas/generator-options'
import type { generationParamsSchema } from '@/lib/canvas-agent/tool-schemas'
import type { CanvasGenerationConfig } from '../../types'
import { CanvasAgentToolError } from '../tool-error'

type Params = z.output<typeof generationParamsSchema>

export function normalizeAgentGenerationParams(type: 'image' | 'video', input: Params, previous?: CanvasGenerationConfig | null) {
  const allowed = type === 'image'
    ? ['aspectRatio', 'resolution', 'quality']
    : ['aspectRatio', 'resolution', 'duration', 'generateAudio', 'inputMode']
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new CanvasAgentToolError('INVALID_PARAM')
  try {
    // Normalize only the supplied fields. A title/prompt edit must not
    // overwrite a custom setting or write UI defaults to a hydrated node.
    const values = type === 'image' ? normalizeCanvasImageGenerationOptions(input)
      : { ...normalizeCanvasVideoGenerationOptions(input, input.inputMode ?? previous?.inputMode), inputMode: input.inputMode }
    return Object.fromEntries(Object.keys(input).map((key) => [key, values[key as keyof typeof values]])) as Partial<CanvasGenerationConfig>
  } catch {
    throw new CanvasAgentToolError('INVALID_PARAM')
  }
}
