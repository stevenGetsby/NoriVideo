import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('novel promotion video display stability', () => {
  it('keeps the video element mounted after playback ends', () => {
    const playerSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/usePanelPlayer.ts',
      ),
      'utf8',
    )
    const headerSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardHeader.tsx',
      ),
      'utf8',
    )

    expect(playerSource).toContain('hasStartedPlayback')
    expect(playerSource).toContain('handleEnded')
    expect(playerSource).toContain('[currentVideoUrl]')
    expect(headerSource).toContain('player.isPlaying || player.hasStartedPlayback')
    expect(headerSource).toContain("key={`video-${panel.storyboardId}-${panel.panelIndex}-${media.showLipSyncVideo ? 'lip-sync' : 'base'}`}")
    expect(headerSource).not.toContain('key={`video-${panel.storyboardId}-${panel.panelIndex}-${media.currentVideoUrl}`}')
    expect(headerSource).toContain('onEnded={player.handleEnded}')
  })

  it('does not show stale running task state once a panel already has output media', () => {
    const projectionSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/lib/novel-promotion/stages/video-stage-runtime/useVideoPanelsProjection.ts',
      ),
      'utf8',
    )
    const runtimeSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/lib/novel-promotion/stages/video-stage-runtime-core.tsx',
      ),
      'utf8',
    )
    const storyboardTaskSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardTaskAwareStoryboards.ts',
      ),
      'utf8',
    )

    expect(projectionSource).toContain('const hasVideoOutput = Boolean(panel.videoUrl)')
    expect(projectionSource).toContain('const shouldShowVideoTaskState = !hasVideoOutput || panelVideoState?.hasOutputAtStart === true')
    expect(projectionSource).toContain('const isVideoTaskRunning = shouldShowVideoTaskState')
    expect(projectionSource).toContain('const hasLipSyncOutput = Boolean(panel.lipSyncVideoUrl)')
    expect(projectionSource).toContain('const shouldShowLipSyncTaskState = !hasLipSyncOutput || panelLipState?.hasOutputAtStart === true')
    expect(projectionSource).toContain('const isLipSyncTaskRunning = shouldShowLipSyncTaskState')
    expect(runtimeSource).toContain('if (panel.videoUrl && isSubmittingVideoBatch && !submittingVideoPanelKeys.has(panelKey)) return panel')
    expect(storyboardTaskSource).toContain('const shouldShowPanelImageTaskState = !panel.imageUrl || panelImageTaskState?.hasOutputAtStart === true')
    expect(storyboardTaskSource).toContain('const shouldShowPanelVideoTaskState = !panel.videoUrl || panelVideoTaskState?.hasOutputAtStart === true')
    expect(storyboardTaskSource).toContain('const shouldShowPanelLipSyncTaskState = !panel.lipSyncVideoUrl || panelLipSyncTaskState?.hasOutputAtStart === true')
  })
})
