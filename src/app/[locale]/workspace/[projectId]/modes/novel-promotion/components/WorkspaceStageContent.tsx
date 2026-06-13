'use client'

import dynamic from 'next/dynamic'
import WorkbenchFocusPanel from './WorkbenchFocusPanel'
import type { Episode } from '../types'
import type { NovelPromotionProject } from '@/types/project'

const StageLoading = () => (
  <div className="min-h-[360px] animate-pulse rounded-lg bg-[var(--glass-bg-muted)]" />
)

const ConfigStage = dynamic(() => import('./ConfigStage'), {
  loading: StageLoading,
})

const ScriptStage = dynamic(() => import('./ScriptStage'), {
  loading: StageLoading,
})

const VideoStageRoute = dynamic(() => import('./VideoStageRoute'), {
  loading: StageLoading,
})

const VoiceStageRoute = dynamic(() => import('./VoiceStageRoute'), {
  loading: StageLoading,
})

const ExportDeliveryStage = dynamic(() => import('./ExportDeliveryStage'), {
  loading: StageLoading,
})

interface WorkspaceStageContentProps {
  projectId: string
  currentStage: string
  projectData?: NovelPromotionProject | null
  episode?: Episode | null
  episodes?: Episode[]
}

export default function WorkspaceStageContent({
  projectId,
  currentStage,
  projectData,
  episode,
  episodes,
}: WorkspaceStageContentProps) {
  return (
    <div key={currentStage} className="animate-page-enter">
      <WorkbenchFocusPanel
        projectId={projectId}
        currentStage={currentStage}
        projectData={projectData}
        episode={episode}
        episodes={episodes}
      />

      {currentStage === 'config' && <ConfigStage />}

      {(currentStage === 'script' || currentStage === 'assets') && <ScriptStage />}

      {currentStage === 'storyboard' && <VideoStageRoute viewMode="storyboard" />}

      {currentStage === 'videos' && <VideoStageRoute viewMode="final" />}

      {currentStage === 'editor' && <ExportDeliveryStage />}

      {currentStage === 'voice' && <VoiceStageRoute />}
    </div>
  )
}
