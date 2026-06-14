const INTERNAL_AGENT_WORKFLOW_TYPES = new Set<string>([
  'super_agent_creation',
  'super_agent_chat_edit',
])

const INTERNAL_AGENT_TASK_TYPES = new Set<string>([
  'super_agent_execute',
])

export function listInternalAgentTaskTypes() {
  return Array.from(INTERNAL_AGENT_TASK_TYPES)
}

export function isInternalAgentWorkflowType(workflowType?: string | null) {
  return !!workflowType && INTERNAL_AGENT_WORKFLOW_TYPES.has(workflowType)
}

export function isInternalAgentTaskType(taskType?: string | null) {
  return !!taskType && INTERNAL_AGENT_TASK_TYPES.has(taskType)
}

export function canExposeInternalAgentRuns() {
  return process.env.NORI_INTERNAL_AGENT_TOOLS === 'true'
}

export function isPublicRunApiVisible(run: { workflowType?: string | null }) {
  return !isInternalAgentWorkflowType(run.workflowType) || canExposeInternalAgentRuns()
}

export function isPublicTaskApiVisible(task: { type?: string | null; taskType?: string | null }) {
  const taskType = task.taskType ?? task.type ?? null
  return !isInternalAgentTaskType(taskType) || canExposeInternalAgentRuns()
}
