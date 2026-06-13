export function buildAgentWorkspaceVideoUrl(params: {
  locale?: string
  projectId: string
  episodeId: string
}): string {
  const locale = params.locale || 'zh'
  const searchParams = new URLSearchParams({
    episode: params.episodeId,
    stage: 'videos',
  })
  return `/${locale}/workspace/${params.projectId}?${searchParams.toString()}`
}

export function normalizeAgentWorkspaceVideoUrl(
  workspaceUrl: string,
  episodeId?: string | null,
): string {
  const trimmed = workspaceUrl.trim()
  if (!trimmed) return trimmed

  try {
    const parsed = new URL(trimmed, 'https://nori.local')
    if (episodeId && !parsed.searchParams.get('episode')) {
      parsed.searchParams.set('episode', episodeId)
    }
    parsed.searchParams.set('stage', 'videos')
    return `${parsed.pathname}?${parsed.searchParams.toString()}${parsed.hash}`
  } catch {
    const joiner = trimmed.includes('?') ? '&' : '?'
    const episodeParam = episodeId && !/[?&]episode=/.test(trimmed)
      ? `episode=${encodeURIComponent(episodeId)}&`
      : ''
    return `${trimmed}${joiner}${episodeParam}stage=videos`
  }
}
