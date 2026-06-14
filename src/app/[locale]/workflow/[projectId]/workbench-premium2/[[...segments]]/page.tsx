import { FosWorkflowClient, type FosView } from '@/components/frameos/FosWorkflowClient'

interface WorkflowPremiumWorkbenchPageProps {
  params: Promise<{
    locale: string
    projectId: string
    segments?: string[]
  }>
}

function resolveView(segments: string[] = []): { view: FosView; focus?: string } {
  const path = segments.filter(Boolean).join('/')
  if (!path) return { view: 'overview' }
  if (path === 'script-review') return { view: 'script-review', focus: 'script-review' }
  if (path === 'assets/characters') return { view: 'assets', focus: 'characters' }
  if (path === 'assets/items') return { view: 'assets', focus: 'items' }
  if (path === 'assets/environments') return { view: 'assets', focus: 'environments' }
  if (path === 'assets/timbre') return { view: 'assets', focus: 'timbre' }
  if (path === 'storyboard') return { view: 'storyboard', focus: 'storyboard' }
  if (path === 'production/episodes') return { view: 'production', focus: 'episodes' }
  if (path === 'production/timeline') return { view: 'production', focus: 'timeline' }
  if (path === 'production/shot' || path.startsWith('production/shot/')) return { view: 'production', focus: 'shot' }
  return { view: 'overview' }
}

export default async function WorkflowPremiumWorkbenchPage({ params }: WorkflowPremiumWorkbenchPageProps) {
  const resolved = await params
  const { view, focus } = resolveView(resolved.segments)
  return <FosWorkflowClient projectId={resolved.projectId} view={view} focus={focus} />
}
