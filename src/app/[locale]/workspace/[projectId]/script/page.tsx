import { redirect } from 'next/navigation'
import { buildWorkspaceStageUrl } from '@/lib/workspace/frameos-workbench-routes'

interface ScriptBridgePageProps {
  params: Promise<{ locale: string; projectId: string }>
  searchParams: Promise<{ episode?: string }>
}

export default async function ScriptBridgePage({ params, searchParams }: ScriptBridgePageProps) {
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
