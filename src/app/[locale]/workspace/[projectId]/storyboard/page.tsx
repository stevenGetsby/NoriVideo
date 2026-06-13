import { redirect } from 'next/navigation'
import { buildWorkspaceStageUrl } from '@/lib/workspace/frameos-workbench-routes'

interface StoryboardBridgePageProps {
  params: Promise<{ locale: string; projectId: string }>
  searchParams: Promise<{ episode?: string }>
}

export default async function StoryboardBridgePage({ params, searchParams }: StoryboardBridgePageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  redirect(buildWorkspaceStageUrl({
    locale: resolvedParams.locale,
    projectId: resolvedParams.projectId,
    stage: 'storyboard',
    focus: 'storyboard',
    episode: resolvedSearchParams.episode,
  }))
}
