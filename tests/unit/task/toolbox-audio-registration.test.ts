import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getQueueTypeByTaskType } from '@/lib/task/queues'
import { resolveTaskIntent } from '@/lib/task/intent'
import { TASK_TYPE } from '@/lib/task/types'

describe('toolbox audio task registration', () => {
  it('routes audio generation through the durable voice queue', () => {
    expect(getQueueTypeByTaskType(TASK_TYPE.TOOLBOX_AUDIO)).toBe('voice')
    expect(resolveTaskIntent(TASK_TYPE.TOOLBOX_AUDIO)).toBe('generate')
    const worker = fs.readFileSync(path.join(process.cwd(), 'src/lib/workers/voice.worker.ts'), 'utf8')
    expect(worker).toContain('case TASK_TYPE.TOOLBOX_AUDIO:')
    expect(worker).toContain('handleToolboxAudioTask(job)')
  })
})

