import type { Job } from 'bullmq'
import type { TaskJobData } from '@/lib/task/types'

export async function handleVoiceDesignTask(_job: Job<TaskJobData>): Promise<never> {
  throw new Error('VOICE_DESIGN_RETIRED: Kuaizi 当前不提供 AI 声音设计能力')
}
