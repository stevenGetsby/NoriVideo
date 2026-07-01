import { TASK_TYPE, type TaskType } from '@/lib/task/types'

const NON_AI_TASK_TYPES: ReadonlySet<TaskType> = new Set<TaskType>([
  TASK_TYPE.EXPORT_DELIVERY,
  TASK_TYPE.EPISODE_SPLIT_LLM,
])

const AI_TASK_TYPES: ReadonlySet<TaskType> = new Set<TaskType>(
  Object.values(TASK_TYPE).filter((type) => !NON_AI_TASK_TYPES.has(type)),
)

export function isAiTaskType(type: TaskType): boolean {
  return AI_TASK_TYPES.has(type)
}

export function workflowTypeFromTaskType(type: TaskType): string {
  return type
}
