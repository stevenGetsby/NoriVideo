import type { CanvasNodeData } from './types'

export type VideoVersionPrompt = {
  prompt: string
  source: 'history' | 'metadata' | 'node' | 'none'
  modelKey?: string | null
  parameters?: Record<string, string | number | boolean | null>
}

function mediaPath(url: string) {
  try {
    const parsed = new URL(url, 'https://canvas.local')
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.split('?')[0]
  }
}

export function resolveVideoVersionPrompt(data: CanvasNodeData): VideoVersionPrompt {
  const currentUrl = data.videoUrl || data.contentUrl
  if (currentUrl) {
    const path = mediaPath(currentUrl)
    const matches = (data.history || [])
      .filter((item) => typeof item.url === 'string' && mediaPath(item.url) === path && typeof item.prompt === 'string' && item.prompt.trim())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const latest = matches[0]
    if (latest) return { prompt: latest.prompt!, source: 'history', modelKey: latest.modelKey, parameters: latest.parameters }
  }
  const metadataPrompt = data.sourceMetadata?.prompt
  if (typeof metadataPrompt === 'string' && metadataPrompt.trim()) return { prompt: metadataPrompt, source: 'metadata' }
  if (typeof data.prompt === 'string' && data.prompt.trim()) return { prompt: data.prompt, source: 'node' }
  return { prompt: '', source: 'none' }
}
