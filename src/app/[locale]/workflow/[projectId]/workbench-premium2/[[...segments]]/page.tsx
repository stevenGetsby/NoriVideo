import { FosWorkflowClient, type FosView } from '@/components/frameos/FosWorkflowClient'
import { assignmentReturnPath } from '@/components/frameos/assignments-view-model'

interface WorkflowPremiumWorkbenchPageProps {
  params: Promise<{
    locale: string
    projectId: string
    segments?: string[]
  }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
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
  if (path === 'canvas') return { view: 'canvas', focus: 'canvas' }
  if (segments[0] === 'canvas' && segments[1]) return { view: 'canvas', focus: segments[1] }
  if (path === 'production/episodes') return { view: 'production', focus: 'episodes' }
  if (path === 'production/timeline') return { view: 'production', focus: 'timeline' }
  if (path === 'production/shot' || path.startsWith('production/shot/')) return { view: 'production', focus: 'shot' }
  return { view: 'overview' }
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.find(Boolean)
  return value || undefined
}

export default async function WorkflowPremiumWorkbenchPage({ params, searchParams }: WorkflowPremiumWorkbenchPageProps) {
  const [resolved, query] = await Promise.all([params, searchParams])
  const { view, focus } = resolveView(resolved.segments)
  return (
    <FosWorkflowClient
      projectId={resolved.projectId}
      view={view}
      focus={focus}
      initialEpisodeId={firstQueryValue(query.episode_id)}
      initialCanvasNodeId={firstQueryValue(query.node_id)}
      assignmentReturnTo={assignmentReturnPath(
        firstQueryValue(query.from),
        firstQueryValue(query.from_tab),
      ) ?? undefined}
    />
  )
}
