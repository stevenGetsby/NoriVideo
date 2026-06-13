import { redirect } from 'next/navigation'
import {
  buildWorkspaceStageUrl,
  resolveFrameWorkbenchTarget,
} from '@/lib/workspace/frameos-workbench-routes'

interface PremiumWorkbenchBridgePageProps {
  params: Promise<{
    locale: string
    projectId: string
    segments?: string[]
  }>
  searchParams: Promise<{
    episode?: string
  }>
}

export default async function PremiumWorkbenchBridgePage({ params, searchParams }: PremiumWorkbenchBridgePageProps) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  const target = resolveFrameWorkbenchTarget(resolvedParams.segments)

  redirect(buildWorkspaceStageUrl({
    locale: resolvedParams.locale,
    projectId: resolvedParams.projectId,
    stage: target.stage,
    focus: target.focus,
    shotId: target.shotId,
    episode: resolvedSearchParams.episode,
    variant: 'premium2',
  }))
}
