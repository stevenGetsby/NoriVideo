import { describe, expect, it } from 'vitest'
import {
  publicGenerationTaskId,
  sanitizePublicLifecycleEvent,
  serializePublicTask,
} from '@/lib/task/public-presentation'

describe('public generation task presentation', () => {
  it('returns only the raw upstream task ID, including colon-separated IDs', () => {
    const task = serializePublicTask({
      id: 'task-1',
      externalId: 'KUAIZI:VIDEO:cHJvdmlkZXI:bW9kZWw:cgt:123',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'KUAIZI_HTTP_ERROR(400): content rejected',
      payload: { stage: 'polling_external', externalId: 'KUAIZI:VIDEO:cHJvdmlkZXI:bW9kZWw:cgt:123' },
      result: { imageUrl: 'https://cdn.example/image.png' },
    })
    expect(task.cgtid).toBe('cgt:123')
    expect(task.externalId).toBeUndefined()
    expect(task.errorMessage).toBe('GENERATION_SERVICE_HTTP_ERROR(400): content rejected')
    expect(task.error?.message).toBe('GENERATION_SERVICE_HTTP_ERROR(400): content rejected')
    expect(task.payload).toEqual({ stage: 'polling_external', externalId: null })
    expect(task.result).toEqual({ imageUrl: 'https://cdn.example/image.png' })
    expect(JSON.stringify(task)).not.toMatch(/kuaizi|openlux|筷子/i)
  })

  it('keeps synchronous image request IDs and rejects legacy provider routing strings', () => {
    expect(publicGenerationTaskId('img-request-123')).toBe('img-request-123')
    expect(publicGenerationTaskId('OPENAI:VIDEO:provider:request-123')).toBeNull()
    expect(publicGenerationTaskId('KUAIZI:VIDEO:invalid')).toBeNull()
    expect(publicGenerationTaskId(null)).toBeNull()
  })

  it('sanitizes lifecycle events without exposing provider identifiers', () => {
    const event = sanitizePublicLifecycleEvent({
      taskId: 'task-1',
      payload: {
        message: 'OPENLUX_IMAGE_TIMEOUT',
        externalId: 'KUAIZI:IMAGE:cHJvdmlkZXI:bW9kZWw:cgt-image-1',
      },
    })
    expect(JSON.stringify(event)).not.toMatch(/kuaizi|openlux/i)
    expect(event.payload).toEqual({ message: 'GENERATION_SERVICE_IMAGE_TIMEOUT', externalId: null })
  })
})
