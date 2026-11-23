/** Rendering and transport can be rolled back independently of each other. */
export function resolveCanvasPerformanceFlags({
  mode, workId, production, workIds, summary, projection,
}: {
  mode: 'canvas' | 'story'
  workId?: string | null
  production: boolean
  workIds?: string
  summary?: string
  projection?: string
}) {
  const allowed = mode === 'canvas' && (!production || Boolean(
    workId && workIds?.split(',').some((id) => id.trim() === workId),
  ))
  const featureEnabled = (setting: string | undefined) => allowed && (production ? setting === '1' : setting !== '0')
  return { summary: featureEnabled(summary), projection: featureEnabled(projection) }
}
