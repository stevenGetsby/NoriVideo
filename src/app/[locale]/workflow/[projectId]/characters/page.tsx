import { redirect } from 'next/navigation'
import { buildWorkspaceStageUrl } from '@/lib/workspace/frameos-workbench-routes'

interface WorkflowCharactersPageProps {
  params: Promise<{ locale: string; projectId: string }>
  searchParams: Promise<{ episode?: string }>
}

export default async function WorkflowCharactersPage({ params, searchParams }: WorkflowCharactersPageProps) {
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
