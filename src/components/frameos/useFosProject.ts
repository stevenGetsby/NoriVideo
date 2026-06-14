'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'

export interface FosScene {
  id: string
  sceneNumber: string
  heading: string | null
  location: string | null
  time: string | null
  intExt: string | null
  content: string | null
  characters: string[]
}

export interface FosEpisode {
  id: string
  episodeNumber: number
  name: string
  novelText: string | null
  wordCount: number
  status?: string | null
  scenes?: FosScene[]
}

export interface FosWorldSetting {
  label: string
  background: string | null
  artStyle: string
  artStylePrompt: string | null
  projectStyle: string
}

export interface FosAsset {
  id: string
  name: string
  type: string
  description: string | null
  prompt: string | null
  imageUrl: string | null
  confirmed: boolean
}

export interface FosProjectData {
  projectId: string
  projectName: string
  loading: boolean
  episodes: FosEpisode[]
  characters: FosAsset[]
  items: FosAsset[]
  environments: FosAsset[]
  world: FosWorldSetting | null
  scriptApproved: boolean
  /** true when the backend returned no real content and demo data is shown */
  usingDemo: boolean
  refetch: () => void
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function mapAsset(raw: Record<string, unknown>, fallbackType: string): FosAsset {
  return {
    id: String(raw.id ?? Math.random()),
    name: asString(raw.name) ?? '未命名',
    type: asString(raw.assetKind) ?? asString(raw.role) ?? asString(raw.type) ?? fallbackType,
    description: asString(raw.description) ?? asString(raw.background) ?? null,
    prompt: asString(raw.prompt) ?? asString(raw.imagePrompt) ?? asString(raw.appearancePrompt) ?? null,
    imageUrl: asString(raw.imageUrl) ?? asString(raw.mainImageUrl) ?? null,
    confirmed: raw.confirmed === true || asString(raw.status) === 'confirmed',
  }
}

const PROJECT_STYLE_LABELS: Record<string, string> = {
  'live-action': '真人',
  anime: '动漫',
}

/** Episode FrameOS metadata (scenes/status) is stored inside the speakerVoices JSON blob. */
function readEpisodeMetadata(raw: Record<string, unknown>): { status: string | null; scenes: FosScene[] } {
  let blob: Record<string, unknown> | null = null
  const speakerVoices = raw.speakerVoices
  if (isRecord(speakerVoices)) blob = speakerVoices
  else if (typeof speakerVoices === 'string') {
    try { const parsed = JSON.parse(speakerVoices) as unknown; if (isRecord(parsed)) blob = parsed } catch { /* ignore */ }
  }
  const meta = blob && isRecord(blob._frameosEpisodeMetadata) ? blob._frameosEpisodeMetadata : null
  const status = meta ? asString(meta.status) : null
  const rawScenes = meta && Array.isArray(meta.scenes) ? meta.scenes : []
  const scenes: FosScene[] = rawScenes.filter(isRecord).map((s, i) => ({
    id: asString(s.scene_id) ?? `scene-${i}`,
    sceneNumber: asString(s.scene_number) ?? String(i + 1),
    heading: asString(s.heading),
    location: asString(s.location),
    time: asString(s.time),
    intExt: asString(s.int_ext),
    content: asString(s.content),
    characters: Array.isArray(s.characters) ? s.characters.filter((c): c is string => typeof c === 'string') : [],
  }))
  return { status, scenes }
}

export function useFosProject(projectId: string): FosProjectData {
  const [data, setData] = useState<FosProjectData>({
    projectId, projectName: 'TEST', loading: true,
    episodes: [], characters: [], items: [], environments: [],
    world: null, scriptApproved: false, usingDemo: false, refetch: () => {},
  })
  const [reloadKey, setReloadKey] = useState(0)
  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      let projectName = 'TEST'
      let episodes: FosEpisode[] = []
      let characters: FosAsset[] = []
      let items: FosAsset[] = []
      let environments: FosAsset[] = []
      let world: FosWorldSetting | null = null
      let scriptApproved = false

      // Project base info + art-style/world settings via the consolidated data endpoint.
      try {
        const res = await apiFetch(`/api/projects/${projectId}/data`)
        if (res.ok) {
          const json = await res.json() as { project?: Record<string, unknown> }
          const project = json.project ?? {}
          projectName = asString(project.name) ?? 'TEST'
          const npd = isRecord(project.novelPromotionData) ? project.novelPromotionData : {}
          const artStyle = asString(npd.artStyle) ?? 'american-comic'
          const projectStyle = asString(npd.projectStyle) ?? 'live-action'
          world = {
            label: PROJECT_STYLE_LABELS[projectStyle] ?? projectStyle,
            background: asString(npd.description) ?? asString(project.description),
            artStyle,
            artStylePrompt: asString(npd.artStylePrompt),
            projectStyle,
          }
        }
      } catch { /* keep defaults */ }

      // Fallback for project name if the data endpoint is unavailable.
      if (projectName === 'TEST') {
        try {
          const res = await apiFetch(`/api/projects/${projectId}`)
          if (res.ok) {
            const p = await res.json() as { project?: { name?: string } }
            projectName = p.project?.name?.trim() || 'TEST'
          }
        } catch { /* keep default */ }
      }

      try {
        const res = await apiFetch(`/api/novel-promotion/${projectId}/episodes`)
        if (res.ok) {
          const json = await res.json() as { episodes?: Array<Record<string, unknown>> }
          episodes = (json.episodes ?? []).map((e) => {
            const { status, scenes } = readEpisodeMetadata(e)
            return {
              id: String(e.id),
              episodeNumber: Number(e.episodeNumber) || 0,
              name: asString(e.name) ?? `第 ${e.episodeNumber} 集`,
              novelText: asString(e.novelText),
              wordCount: (asString(e.novelText) ?? '').length,
              status,
              scenes,
            }
          })
        }
      } catch { /* ignore */ }

      try {
        const res = await apiFetch(`/api/novel-promotion/${projectId}/assets`)
        if (res.ok) {
          const json = await res.json() as {
            characters?: Array<Record<string, unknown>>
            locations?: Array<Record<string, unknown>>
            props?: Array<Record<string, unknown>>
          }
          characters = (json.characters ?? []).map((c) => mapAsset(c, '角色'))
          environments = (json.locations ?? []).map((c) => mapAsset(c, '环境'))
          items = (json.props ?? []).map((c) => mapAsset(c, '物品'))
        }
      } catch { /* ignore */ }

      // Script-parse stage approval state (config stage = 剧本解析).
      try {
        const res = await apiFetch(`/api/workflow/projects/${projectId}/stages/config`)
        if (res.ok) {
          const json = await res.json() as { status?: string; reviewState?: string | null }
          scriptApproved = json.status === 'approved' || json.reviewState === 'approved'
        }
      } catch { /* ignore */ }

      const usingDemo = episodes.length === 0 && characters.length === 0 && environments.length === 0
      if (!cancelled) {
        setData({
          projectId, projectName, loading: false,
          episodes, characters, items, environments,
          world, scriptApproved, usingDemo, refetch,
        })
      }
    }
    void load()
    return () => { cancelled = true }
  }, [projectId, reloadKey, refetch])

  return data
}
