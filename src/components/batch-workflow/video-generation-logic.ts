import type {
  BatchItemDTO,
  StoryboardArtifact,
  VideoGenShotOverride,
} from '@/lib/batch-workflow/types'

export interface VideoGenerationOptions {
  shotIds?: string[]
  forceRerun?: boolean
  updatedStoryboard?: StoryboardArtifact
  shotOverrides?: Record<string, VideoGenShotOverride>
}

export function hasReadyVideoTake(item: Pick<BatchItemDTO, 'stageOutputs'>): boolean {
  return Boolean(item.stageOutputs.video_gen?.shots.some((shot) => (
    shot.takes.some((take) => take.status === 'ready')
  )))
}

export function buildVideoGenerationBody(
  item: Pick<BatchItemDTO, 'stageOutputs'>,
  opts: VideoGenerationOptions = {},
): {
  action: 'generate'
  shotIds?: string[]
  regenerateAll?: true
  forceRerun?: true
  shotOverrides?: Record<string, VideoGenShotOverride>
} {
  const hasTargets = Boolean(opts.shotIds?.length)
  const regenerateAll = Boolean(opts.forceRerun && !hasTargets && hasReadyVideoTake(item))
  return {
    action: 'generate',
    ...(hasTargets ? { shotIds: opts.shotIds } : {}),
    ...(regenerateAll ? { regenerateAll: true as const } : {}),
    ...(opts.forceRerun ? { forceRerun: true as const } : {}),
    ...(opts.shotOverrides && hasTargets ? { shotOverrides: opts.shotOverrides } : {}),
  }
}

export function getRegenerateAllCostConfirmation(item: Pick<BatchItemDTO, 'stageOutputs'>): string | null {
  if (!hasReadyVideoTake(item)) return null
  const shotCount = item.stageOutputs.storyboard?.shots.length
    || item.stageOutputs.video_gen?.shots.length
    || 0
  return `将重新生成全部 ${shotCount} 个镜头，并重新消耗对应的视频生成额度；旧版本会保留。确认整体重抽吗？`
}

export function deriveVideoShotOverrides(
  storyboard: StoryboardArtifact | undefined,
  shotIds?: string[],
): Record<string, VideoGenShotOverride> | undefined {
  if (!storyboard || !shotIds?.length) return undefined
  const overrides = Object.fromEntries(storyboard.shots
    .filter((shot) => shotIds.includes(shot.shotId))
    .map((shot) => [shot.shotId, {
      durationSeconds: shot.durationSec,
      prompt: shot.videoPrompt,
      inputMode: shot.inputMode,
    }]))
  return Object.keys(overrides).length > 0 ? overrides : undefined
}
