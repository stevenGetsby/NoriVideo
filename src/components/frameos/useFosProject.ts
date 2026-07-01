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

export interface FosAssetVariant {
  id?: string
  appearanceId?: string | null
  label: string
  episodes: string | null
  description: string
  imageUrl?: string | null
  changeText?: string | null
  fullPrompt?: string | null
  promptKind?: string | null
}

export interface FosAsset {
  id: string
  mainAppearanceId?: string | null
  name: string
  type: string
  description: string | null
  prompt: string | null
  imageUrl: string | null
  confirmed: boolean
  episodes?: string | null
  variants?: FosAssetVariant[]
}

export interface FosProjectData {
  projectId: string
  projectName: string
  loading: boolean
  scriptImportStatus: string | null
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

type FosProjectSnapshot = Omit<FosProjectData, 'loading' | 'refetch'>

const PROJECT_DATA_CACHE_TTL_MS = 15_000
const projectDataCache = new Map<string, { snapshot: FosProjectSnapshot; storedAt: number }>()

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function mapAssetVariants(raw: unknown): FosAssetVariant[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((variant, index) => {
    const promptKind = asString(variant.promptKind)
    const changeText = asString(variant.changeText)
    return {
      id: String(variant.id ?? index),
      appearanceId: asString(variant.appearanceId),
      label: asString(variant.label) ?? `变体 ${index + 1}`,
      episodes: asString(variant.episodes),
      description: changeText ?? asString(variant.description) ?? asString(variant.prompt) ?? '',
      imageUrl: asString(variant.imageUrl),
      changeText,
      fullPrompt: asString(variant.fullPrompt) ?? asString(variant.prompt),
      promptKind,
    }
  }).filter((variant) => variant.description && variant.promptKind !== 'text_to_image')
}

function mapAsset(raw: Record<string, unknown>, fallbackType: string): FosAsset {
  return {
    id: String(raw.id ?? Math.random()),
    mainAppearanceId: asString(raw.mainAppearanceId),
    name: asString(raw.name) ?? '未命名',
    type: asString(raw.assetKind) ?? asString(raw.role) ?? asString(raw.type) ?? fallbackType,
    description: asString(raw.description) ?? asString(raw.background) ?? null,
    prompt: asString(raw.prompt) ?? asString(raw.imagePrompt) ?? asString(raw.appearancePrompt) ?? null,
    imageUrl: asString(raw.imageUrl) ?? asString(raw.mainImageUrl) ?? null,
    confirmed: raw.confirmed === true || asString(raw.status) === 'confirmed',
    episodes: asString(raw.episodes),
    variants: mapAssetVariants(raw.variants),
  }
}

const PROJECT_STYLE_LABELS: Record<string, string> = {
  'live-action': '真人',
  anime: '动漫',
}
const IMPORT_ACTIVE_STATUSES = new Set(['pending', 'processing'])

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
    scriptImportStatus: null,
    episodes: [], characters: [], items: [], environments: [],
    world: null, scriptApproved: false, usingDemo: false, refetch: () => {},
  })
  const [reloadKey, setReloadKey] = useState(0)
  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])
  const { scriptImportStatus, usingDemo } = data

  useEffect(() => {
    let cancelled = false
    async function load() {
      const cached = projectDataCache.get(projectId)
      if (cached && Date.now() - cached.storedAt < PROJECT_DATA_CACHE_TTL_MS && reloadKey === 0) {
        setData({ ...cached.snapshot, loading: false, refetch })
        return
      }
      if (cached && reloadKey === 0) {
        setData({ ...cached.snapshot, loading: false, refetch })
      }

      const loadProjectBase = async (): Promise<{
        projectName: string | null
        scriptImportStatus: string | null
        world: FosWorldSetting | null
      }> => {
        const res = await apiFetch(`/api/projects/${projectId}/data`)
        if (res.ok) {
          const json = await res.json() as { project?: Record<string, unknown> }
          const project = json.project ?? {}
          const npd = isRecord(project.novelPromotionData) ? project.novelPromotionData : {}
          const artStyle = asString(npd.artStyle) ?? 'american-comic'
          const projectStyle = asString(npd.projectStyle) ?? 'live-action'
          return {
            projectName: asString(project.name),
            scriptImportStatus: asString(npd.importStatus),
            world: {
              label: PROJECT_STYLE_LABELS[projectStyle] ?? projectStyle,
              background: asString(npd.description) ?? asString(project.description),
              artStyle,
              artStylePrompt: asString(npd.artStylePrompt),
              projectStyle,
            },
          }
        }
        return { projectName: null, scriptImportStatus: null, world: null }
      }

      const loadFallbackProjectName = async (): Promise<string | null> => {
        const res = await apiFetch(`/api/projects/${projectId}`)
        if (!res.ok) return null
        const p = await res.json() as { project?: { name?: string } }
        return p.project?.name?.trim() || null
      }

      const loadEpisodes = async (): Promise<FosEpisode[]> => {
        const res = await apiFetch(`/api/novel-promotion/${projectId}/episodes`)
        if (!res.ok) return []
        const json = await res.json() as { episodes?: Array<Record<string, unknown>> }
        return (json.episodes ?? []).map((e) => {
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

      const loadAssets = async (): Promise<{
        characters: FosAsset[]
        items: FosAsset[]
        environments: FosAsset[]
      }> => {
        const res = await apiFetch(`/api/novel-promotion/${projectId}/assets`)
        if (!res.ok) return { characters: [], items: [], environments: [] }
        const json = await res.json() as {
          characters?: Array<Record<string, unknown>>
          locations?: Array<Record<string, unknown>>
          props?: Array<Record<string, unknown>>
        }
        return {
          characters: (json.characters ?? []).map((c) => mapAsset(c, '角色')),
          environments: (json.locations ?? []).map((c) => mapAsset(c, '环境')),
          items: (json.props ?? []).map((c) => mapAsset(c, '物品')),
        }
      }

      const loadScriptApproved = async (): Promise<boolean> => {
        const res = await apiFetch(`/api/workflow/projects/${projectId}/stages/config`)
        if (!res.ok) return false
        const json = await res.json() as { status?: string; reviewState?: string | null }
        return json.status === 'approved' || json.reviewState === 'approved'
      }

      const [baseResult, episodes, assets, scriptApproved] = await Promise.all([
        loadProjectBase().catch(() => ({ projectName: null, scriptImportStatus: null, world: null })),
        loadEpisodes().catch(() => []),
        loadAssets().catch(() => ({ characters: [], items: [], environments: [] })),
        loadScriptApproved().catch(() => false),
      ])

      const fallbackProjectName = baseResult.projectName ? null : await loadFallbackProjectName().catch(() => null)
      const projectName = baseResult.projectName || fallbackProjectName || 'TEST'
      const { scriptImportStatus, world } = baseResult
      const { characters, items, environments } = assets

      const usingDemo = episodes.length === 0
        && characters.length === 0
        && environments.length === 0
        && !scriptImportStatus
        && !world
      if (!cancelled) {
        const snapshot: FosProjectSnapshot = {
          projectId,
          projectName,
          scriptImportStatus,
          episodes,
          characters,
          items,
          environments,
          world,
          scriptApproved,
          usingDemo,
        }
        projectDataCache.set(projectId, { snapshot, storedAt: Date.now() })
        setData({
          ...snapshot,
          loading: false,
          refetch,
        })
      }
    }
    void load()
    return () => { cancelled = true }
  }, [projectId, reloadKey, refetch])

  useEffect(() => {
    if (!scriptImportStatus || usingDemo || !IMPORT_ACTIVE_STATUSES.has(scriptImportStatus)) return
    const timer = window.setInterval(refetch, 5000)
    return () => window.clearInterval(timer)
  }, [scriptImportStatus, usingDemo, refetch])

  return data
}
