import { redirect } from 'next/navigation'
import { FosCanvasHubClient } from '@/components/frameos/FosCanvasHubClient'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { chapterHref } from '@/lib/interactive/routes'
import { findStoryChapterRoute } from '@/lib/interactive/service'

interface CanvasHubPageProps {
  params: Promise<{
    locale: string
    segments?: string[]
  }>
}

export default async function CanvasHubPage({ params }: CanvasHubPageProps) {
  const resolved = await params
  const [projectId, canvasId] = resolved.segments || []
  // Old links to a story chapter land in the dedicated chapter editor.
  if (projectId) {
    const auth = await requireUserAuth()
    if (!isErrorResponse(auth)) {
      const chapter = await findStoryChapterRoute(auth.session, decodeURIComponent(projectId))
      if (chapter) redirect(`/${resolved.locale}${chapterHref(chapter.workId, chapter.projectId, canvasId && decodeURIComponent(canvasId))}`)
    }
  }
  return <FosCanvasHubClient initialProjectId={projectId} initialCanvasId={canvasId} />
}
