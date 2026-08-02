import { FosCanvasHubClient } from '@/components/frameos/FosCanvasHubClient'

interface CanvasHubPageProps {
  params: Promise<{
    locale: string
    segments?: string[]
  }>
}

export default async function CanvasHubPage({ params }: CanvasHubPageProps) {
  const resolved = await params
  const [projectId, canvasId] = resolved.segments || []
  return <FosCanvasHubClient initialProjectId={projectId} initialCanvasId={canvasId} />
}
