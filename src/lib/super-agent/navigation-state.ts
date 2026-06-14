import { listRuns } from '@/lib/run-runtime/service'
import { RUN_STATUS, type RunStatus } from '@/lib/run-runtime/types'
import { SUPER_AGENT_WORKFLOW_TYPE } from './workflow-store'

export const ACTIVE_SUPER_AGENT_NAVIGATION_STATUSES: RunStatus[] = [
  RUN_STATUS.QUEUED,
  RUN_STATUS.RUNNING,
  RUN_STATUS.CANCELING,
]

export type SuperAgentNavigationState = {
  projectId: string
  locked: boolean
  source: 'graph-run'
  runId: string | null
  status: RunStatus | null
  updatedAt: string | null
}

export async function readSuperAgentNavigationState(params: {
  userId: string
  projectId: string
}): Promise<SuperAgentNavigationState> {
  const runs = await listRuns({
    userId: params.userId,
    projectId: params.projectId,
    workflowType: SUPER_AGENT_WORKFLOW_TYPE,
    targetType: 'project',
    targetId: params.projectId,
    statuses: ACTIVE_SUPER_AGENT_NAVIGATION_STATUSES,
    recoverableOnly: true,
    latestOnly: true,
    limit: 8,
  })
  const activeRun = runs[0] || null

  return {
    projectId: params.projectId,
    locked: Boolean(activeRun),
    source: 'graph-run',
    runId: activeRun?.id ?? null,
    status: activeRun?.status ?? null,
    updatedAt: activeRun?.updatedAt ?? null,
  }
}
