import type { Job } from 'bullmq'
import { describe, expect, it } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { handleVoiceDesignTask } from '@/lib/workers/handlers/voice-design'

function buildJob(type: TaskJobData['type']): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-voice-1', type, locale: 'zh', projectId: 'project-1',
      targetType: 'VoiceDesign', targetId: 'voice-design-1', payload: {}, userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker voice-design retirement', () => {
  it.each([TASK_TYPE.VOICE_DESIGN, TASK_TYPE.ASSET_HUB_VOICE_DESIGN])(
    'rejects queued %s jobs instead of calling a retired provider',
    async (type) => {
      await expect(handleVoiceDesignTask(buildJob(type))).rejects.toThrow('VOICE_DESIGN_RETIRED')
    },
  )
})
