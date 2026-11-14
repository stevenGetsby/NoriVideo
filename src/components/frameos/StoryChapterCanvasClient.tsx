'use client'

import { CanvasWorkspace } from '@/features/canvas/CanvasWorkspace'
import type { CanvasStoryNavigation } from '@/features/canvas/types'
import { FosShell } from './FosShell'

/** Story chapters keep the ordinary canvas editor and add the story layer on top. */
export function StoryChapterCanvasClient({
  workId,
  workName,
  projectId,
  projectName,
  initialCanvasId,
  storyNavigation,
}: {
  workId: string
  workName: string
  projectId: string
  projectName: string
  initialCanvasId?: string
  /** Server-resolved chapter order for the empty-canvas breadcrumb. */
  storyNavigation?: CanvasStoryNavigation
}) {
  return (
    <FosShell activeKey="interactive" canvasShell titlebarTitle={`${workName} · ${projectName}`}>
      <CanvasWorkspace
        mode="story"
        projectId={projectId}
        projectName={projectName}
        initialCanvasId={initialCanvasId}
        routeBase={`/interactive/${encodeURIComponent(workId)}/chapters/${encodeURIComponent(projectId)}`}
        canvasHomeHref={`/interactive/${encodeURIComponent(workId)}`}
        storyNavigation={storyNavigation}
      />
    </FosShell>
  )
}
