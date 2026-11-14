import { notFound, redirect } from 'next/navigation'
import { StoryChapterCanvasClient } from '@/components/frameos/StoryChapterCanvasClient'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { projectReadScopeWhere } from '@/lib/collaboration/access'
import { findInteractiveStoryByProject } from '@/lib/interactive/service'
import { prisma } from '@/lib/prisma'

interface StoryChapterPageProps {
  params: Promise<{
    locale: string
    workId: string
    projectId: string
    canvas?: string[]
  }>
}

/** Dedicated editor route for one 影游 chapter: the ordinary canvas plus the story layer. */
export default async function StoryChapterPage({ params }: StoryChapterPageProps) {
  const resolved = await params
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) redirect(`/${resolved.locale}/auth/signin`)

  const workId = decodeURIComponent(resolved.workId)
  const projectId = decodeURIComponent(resolved.projectId)
  const project = await prisma.project.findFirst({
    where: { AND: [projectReadScopeWhere(auth.session), { id: projectId, workId }] },
    select: {
      id: true,
      name: true,
      work: { select: { id: true, name: true, productLine: true } },
      canvases: { select: { id: true }, orderBy: { createdAt: 'asc' } },
    },
  })
  if (!project || project.work.productLine !== 'story') notFound()

  // The chapter picker follows the story config order rather than DB row order.
  const story = await findInteractiveStoryByProject(auth.session, projectId)
  if (!story) notFound()

  const requestedCanvasId = resolved.canvas?.[0] ? decodeURIComponent(resolved.canvas[0]) : undefined
  const canvasId = project.canvases.some((canvas) => canvas.id === requestedCanvasId)
    ? requestedCanvasId
    : project.canvases[0]?.id

  return (
    <StoryChapterCanvasClient
      workId={project.work.id}
      workName={project.work.name}
      projectId={project.id}
      projectName={project.name}
      initialCanvasId={canvasId}
      storyNavigation={{
        workId: story.workId,
        workName: story.name,
        chapters: story.chapters,
        currentProjectId: project.id,
      }}
    />
  )
}
