import { redirect } from 'next/navigation'
import { buildWorkspaceStageUrl } from '@/lib/workspace/frameos-workbench-routes'

interface CharactersBridgePageProps {
  params: Promise<{ locale: string; projectId: string }>
  searchParams: Promise<{ episode?: string }>
}

export default async function CharactersBridgePage({ params, searchParams }: CharactersBridgePageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  redirect(buildWorkspaceStageUrl({
    locale: resolvedParams.locale,
    projectId: resolvedParams.projectId,
    stage: 'script',
    focus: 'characters',
    episode: resolvedSearchParams.episode,
  }))
}
