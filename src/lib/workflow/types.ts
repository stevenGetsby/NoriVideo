export type WorkflowStage = 'config' | 'script' | 'storyboard' | 'videos' | 'voice' | 'editor'

export type WorkflowStageStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'failed'
  | 'pending_review'
  | 'approved'
  | 'canceled'
  | 'stale'

export type WorkflowStageView = {
  stage: WorkflowStage
  status: WorkflowStageStatus
  locked: boolean
  readonly: boolean
  stale: boolean
  reviewState?: string | null
  progress?: number | null
  blocker?: string | null
  lastRunId: string | null
  lastTaskId: string | null
  errorCode?: string | null
  errorMessage: string | null
  summary: Record<string, unknown> | null
  updatedAt?: string | null
}

export const WORKFLOW_STAGES: WorkflowStage[] = ['config', 'script', 'storyboard', 'videos', 'voice', 'editor']

export const STAGE_LABELS: Record<WorkflowStage, string> = {
  config: '剧本解析',
  script: '资产设定',
  storyboard: '分镜设计',
  videos: '镜头制作',
  voice: '配音制作',
  editor: '导出交付',
}
