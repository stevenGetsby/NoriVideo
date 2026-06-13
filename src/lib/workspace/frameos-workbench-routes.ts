export type FrameWorkbenchRouteVariant = 'standard' | 'premium2'

export interface FrameWorkbenchRouteTarget {
  stage: 'config' | 'script' | 'storyboard' | 'videos' | 'voice' | 'editor'
  focus?: string
  shotId?: string
}

export function resolveFrameWorkbenchTarget(segments: string[] = []): FrameWorkbenchRouteTarget {
  const normalized = segments.filter(Boolean)
  const path = normalized.join('/')

  if (!path) return { stage: 'config', focus: 'workbench' }

  if (path === 'script-review') return { stage: 'config', focus: 'script-review' }

  if (path === 'assets/characters') return { stage: 'script', focus: 'characters' }
  if (path === 'assets/items') return { stage: 'script', focus: 'items' }
  if (path === 'assets/environments') return { stage: 'script', focus: 'environments' }
  if (path === 'assets/timbre') return { stage: 'voice', focus: 'timbre' }

  if (path === 'storyboard') return { stage: 'storyboard', focus: 'storyboard' }

  if (path === 'production/episodes') return { stage: 'videos', focus: 'episodes' }
  if (path === 'production/timeline') return { stage: 'videos', focus: 'timeline' }
  if (path === 'production/shot') return { stage: 'videos', focus: 'shot' }
  if (path.startsWith('production/shot/')) return { stage: 'videos', focus: 'shot-detail', shotId: normalized[2] }
  if (path === 'production/export') return { stage: 'editor', focus: 'export' }

  return { stage: 'config', focus: 'workbench' }
}

export function buildWorkspaceStageUrl(params: {
  locale: string
  projectId: string
  stage: FrameWorkbenchRouteTarget['stage']
  focus?: string
  shotId?: string
  episode?: string | null
  variant?: FrameWorkbenchRouteVariant
}) {
  const searchParams = new URLSearchParams({ stage: params.stage })
  if (params.episode) searchParams.set('episode', params.episode)
  if (params.focus) searchParams.set('focus', params.focus)
  if (params.shotId) searchParams.set('shotId', params.shotId)
  if (params.variant === 'premium2') searchParams.set('workbench', 'premium2')

  return `/${params.locale}/workspace/${params.projectId}?${searchParams.toString()}`
}
