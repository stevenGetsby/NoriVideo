import { notFound, redirect } from 'next/navigation'
import { PublishClient } from '@/features/mp-publish/PublishClient'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { getInteractiveStory } from '@/lib/interactive/service'

interface InteractivePublishPageProps {
  params: Promise<{ locale: string; workId: string }>
}

export default async function InteractivePublishPage({ params }: InteractivePublishPageProps) {
  const resolved = await params
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) redirect(`/${resolved.locale}/auth/signin`)

  const workId = decodeURIComponent(resolved.workId)
  let story: Awaited<ReturnType<typeof getInteractiveStory>>
  try {
    story = await getInteractiveStory(auth.session, workId)
  } catch {
    notFound()
  }
  if (story.story.canManage !== true) notFound()

  return <PublishClient workId={workId} workName={story.story.name} />
}
