import type { EpisodeFrameOSMetadata } from '@/lib/novel-promotion/episode-frameos-metadata'

export interface SplitEpisode {
  number: number
  title: string
  summary: string
  content: string
  wordCount: number
  frameosMetadata?: EpisodeFrameOSMetadata
}

export type WizardStage = 'select' | 'analyzing' | 'preview'

export interface DeleteConfirmState {
  show: boolean
  index: number
  title: string
}
