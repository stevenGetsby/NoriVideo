import { describe, expect, it } from 'vitest'
import {
  publicGenerationTaskId,
  sanitizePublicCanvasData,
  sanitizePublicLifecycleEvent,
  serializePublicTask,
} from '@/lib/task/public-presentation'
import { getTggUserMessage } from '@/lib/errors/user-messages'

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

  it('exposes only the upstream task id for TGG video tasks', () => {
    expect(publicGenerationTaskId('TGG:VIDEO:YQ:Yg:task_1')).toBe('task_1')
    expect(publicGenerationTaskId('TGG:VIDEO:YQ:Yg:task:with:colons')).toBe('task:with:colons')
    expect(publicGenerationTaskId('TGG:IMAGE:YQ:Yg:task_1')).toBeNull()
    expect(publicGenerationTaskId('TGG:VIDEO:invalid')).toBeNull()
  })

  it('maps TGG error codes to actionable Chinese messages without brand names', () => {
    const task = serializePublicTask({
      id: 'task-2',
      externalId: 'TGG:VIDEO:YQ:Yg:task_2',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'TGG_HTTP_ERROR(502): upstream rejected https://tggtoken.org/v1/videos?token=secret',
      payload: {},
      result: {},
    })
    expect(task.cgtid).toBe('task_2')
    expect(task.errorMessage).toBe('视频生成服务暂时不可用，请稍后再试。')
    expect(task.error?.message).toBe('视频生成服务暂时不可用，请稍后再试。')
    expect(JSON.stringify(task)).not.toMatch(/tgg|tggtoken|secret/i)

    const unconfirmed = serializePublicTask({
      id: 'task-3',
      externalId: null,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'TGG_SUBMIT_UNCONFIRMED',
    })
    expect(unconfirmed.errorMessage).toContain('为避免重复扣费请不要立刻重试')
  })

  it('maps canvas node error messages to Chinese before brand sanitization', () => {
    expect(sanitizePublicCanvasData({
      errorMessage: 'TGG_VIDEO_PROMPT_REQUIRED',
      pollErrorMessage: 'TGG_DELIVERY_FAILED',
    })).toEqual({
      errorMessage: '请先填写视频提示词。',
      pollErrorMessage: '视频已生成但交付失败，请稍后重试下载或联系管理员。',
    })
  })
})

describe('tgg user message lookup', () => {
  it('matches suffixed and embedded codes but not unknown or non-tgg codes', () => {
    expect(getTggUserMessage('TGG_HTTP_ERROR(502): boom')).toBe('视频生成服务暂时不可用，请稍后再试。')
    expect(getTggUserMessage('TGG_VIDEO_DURATION_UNSUPPORTED: 7 (allowed: 5, 10)')).toBe('当前视频模型不支持所选时长。')
    expect(getTggUserMessage('External task failed: TGG_RATE_LIMITED')).toBe('视频生成服务繁忙，请稍后再试。')
    expect(getTggUserMessage('TGG_UNKNOWN_CODE')).toBeNull()
    expect(getTggUserMessage('KUAIZI_HTTP_ERROR(400): rejected')).toBeNull()
    expect(getTggUserMessage('xtgg_video_prompt_required')).toBeNull()
    expect(getTggUserMessage(null)).toBeNull()
    expect(getTggUserMessage('')).toBeNull()
  })
})
