import { redirect } from 'next/navigation'
import { buildWorkspaceStageUrl } from '@/lib/workspace/frameos-workbench-routes'

interface WorkflowScriptPageProps {
  params: Promise<{ locale: string; projectId: string }>
  searchParams: Promise<{ episode?: string }>
}

export default async function WorkflowScriptPage({ params, searchParams }: WorkflowScriptPageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  redirect(buildWorkspaceStageUrl({
    locale: resolvedParams.locale,
    projectId: resolvedParams.projectId,
    stage: 'config',
    focus: 'script',
    episode: resolvedSearchParams.episode,
  }))
}
