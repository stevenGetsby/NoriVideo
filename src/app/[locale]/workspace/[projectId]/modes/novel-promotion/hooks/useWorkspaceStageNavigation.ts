'use client'

import type { StageArtifactReadiness } from '@/lib/novel-promotion/stage-readiness'
import type { WorkflowStageState, WorkflowStageStatus } from '@/lib/query/hooks/useProjectData'

export interface CapsuleNavItem {
  id: string
  icon: string
  label: string
  status: 'empty' | 'active' | 'processing' | 'ready'
  progress?: number
  counts?: Record<string, number>
  reason?: string
  disabled?: boolean
  disabledLabel?: string
}

interface UseWorkspaceStageNavigationParams {
  isAnyOperationRunning: boolean
  stageArtifacts: StageArtifactReadiness
  workflowStages?: WorkflowStageState[]
  t: (key: string) => string
}

export function useWorkspaceStageNavigation({
  isAnyOperationRunning,
  stageArtifacts,
  workflowStages,
  t,
}: UseWorkspaceStageNavigationParams): CapsuleNavItem[] {
  const workflowStageMap = new Map(workflowStages?.map((stage) => [stage.id, stage]))

  const getStageStatus = (stageId: WorkflowStageState['id']): WorkflowStageStatus => {
    if (isAnyOperationRunning) return 'processing'

    const serverStage = workflowStageMap.get(stageId)
    if (serverStage) return serverStage.status

    switch (stageId) {
      case 'config':
        return stageArtifacts.hasStory ? 'ready' : 'active'
      case 'script':
        return stageArtifacts.hasScript ? 'ready' : 'empty'
      case 'storyboard':
        return stageArtifacts.hasStoryboard ? 'ready' : 'empty'
      case 'videos':
      case 'editor':
        return stageArtifacts.hasVideo ? 'ready' : 'empty'
      case 'voice':
        return stageArtifacts.hasVoice ? 'ready' : 'empty'
      default:
        return 'empty'
    }
  }

  const buildStageItem = (
    stageId: WorkflowStageState['id'],
    icon: string,
    label: string,
  ): CapsuleNavItem => {
    const serverStage = workflowStageMap.get(stageId)
    return {
      id: stageId,
      icon,
      label,
      status: getStageStatus(stageId),
      progress: serverStage?.progress,
      counts: serverStage?.counts,
      reason: serverStage?.reason,
    }
  }

  return [
    buildStageItem('config', 'S', t('stages.story')),
    buildStageItem('script', 'A', t('stages.script')),
    buildStageItem('storyboard', 'B', t('stages.storyboard')),
    buildStageItem('videos', 'V', t('stages.video')),
    buildStageItem('editor', 'E', t('stages.editor')),
  ]
}
