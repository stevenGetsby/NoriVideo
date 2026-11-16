'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Film, GitBranch, ListTree, Mouse, Play, Sparkles, type IconComponent } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { storyErrorMessage } from '@/features/interactive/story-api-error'
import type { InteractiveStoryConfig, StoryAspectRatio, StoryInteractionKind, StoryNodeType, StoryVariable } from '@/lib/interactive/types'

export const STORY_NODE_ICONS: Record<StoryNodeType, IconComponent> = {
  story_entry: Play,
  story_scene: Film,
  story_choice: GitBranch,
  story_condition: ListTree,
  story_exit: ArrowRight,
  story_ending: Sparkles,
  story_interaction: Mouse,
}

export const STORY_NODE_HUES: Record<StoryNodeType, string> = {
  story_entry: '#34d399',
  story_scene: '#a78bfa',
  story_choice: '#f472b6',
  story_condition: '#38bdf8',
  story_exit: '#fb923c',
  story_ending: '#fbbf24',
  story_interaction: '#a3e635',
}

export type StoryCanvasInfo = {
  workId: string
  name: string
  aspectRatio: StoryAspectRatio
  resolution: string
  canManage: boolean
  config: InteractiveStoryConfig
  chapters: Array<{ projectId: string; name: string; order: number }>
}

export type StoryCanvasPanel = 'gameplay' | 'checks' | null

/** 卡片拿不到 CanvasGraph 的 toast state，用 window 事件把提示送过去。 */
export const STORY_CANVAS_TOAST_EVENT = 'nori:story-toast'

export function notifyStoryCanvas(message: string) {
  window.dispatchEvent(new CustomEvent(STORY_CANVAS_TOAST_EVENT, { detail: { message } }))
}

/** Canvas-level story commands the node cards can trigger. */
export type StoryCanvasActions = {
  /** Opens the "what comes next" menu for a free out-port. */
  quickAdd: (nodeId: string, handleId: string, anchor: { x: number; y: number }) => void
  /** Adds a video / image node above the target card and wires it in as its picture. */
  createPictureNode: (targetId: string, type: 'video' | 'image') => void
  focusNode: (nodeId: string) => void
  removeEdge: (edgeId: string, label?: string) => void
  /** Migrates semantic result ports and confirms any branches that must be disconnected. */
  retargetInteraction: (nodeId: string, nextKind: StoryInteractionKind) => Promise<void>
  /** Removes a result entity and its connected branch in one undoable transaction. */
  removeInteractionHandle: (nodeId: string, handle: string) => Promise<boolean>
  organize: () => void
}

export type StoryCanvasState = {
  projectId: string
  readOnly: boolean
  story: StoryCanvasInfo
  variables: StoryVariable[]
  /** Patches one or more config keys (variables, shop, …) and refreshes the stored config. */
  saveConfig: (patch: Partial<InteractiveStoryConfig>) => Promise<void>
  trialEntryId: string | null | undefined
  openTrial: (entryNodeId?: string | null) => void
  closeTrial: () => void
  panel: StoryCanvasPanel
  setPanel: (panel: StoryCanvasPanel) => void
}

export type StoryCanvasContextValue = StoryCanvasState & { actions: StoryCanvasActions }

export type StoryCanvasLoadStatus = 'disabled' | 'loading' | 'ready' | 'missing'

export type StoryCanvasLoad = {
  story: StoryCanvasState | null
  status: StoryCanvasLoadStatus
}

/** Loads the 影游 a chapter canvas belongs to; null for ordinary 作品, or when story mode is off. */
export function useStoryCanvas(projectId: string, readOnly: boolean, enabled = true): StoryCanvasLoad {
  const [story, setStory] = useState<StoryCanvasInfo | null>(null)
  const [status, setStatus] = useState<StoryCanvasLoadStatus>(enabled ? 'loading' : 'disabled')
  const [trialEntryId, setTrialEntryId] = useState<string | null | undefined>(undefined)
  const [panel, setPanel] = useState<StoryCanvasPanel>(null)

  useEffect(() => {
    let cancelled = false
    setStory(null)
    // Canvas works must not hit the story API at all, so plain canvases stay plain.
    if (!enabled) {
      setStatus('disabled')
      return () => { cancelled = true }
    }
    setStatus('loading')
    void apiFetch(`/api/interactive?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { story?: StoryCanvasInfo | null } | null) => {
        if (cancelled) return
        setStory(payload?.story ?? null)
        setStatus(payload?.story ? 'ready' : 'missing')
      })
      .catch(() => { if (!cancelled) setStatus('missing') })
    return () => { cancelled = true }
  }, [enabled, projectId])

  const saveConfig = useCallback(async (patch: Partial<InteractiveStoryConfig>) => {
    if (!story) return
    const response = await apiFetch(`/api/interactive/${encodeURIComponent(story.workId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: patch }),
    })
    if (!response.ok) throw new Error(await storyErrorMessage(response, '保存玩法设置失败'))
    const payload = await response.json() as { story: { config: InteractiveStoryConfig } }
    setStory((current) => (current ? { ...current, config: payload.story.config } : current))
  }, [story])

  const openTrial = useCallback((entryNodeId?: string | null) => setTrialEntryId(entryNodeId ?? null), [])
  const closeTrial = useCallback(() => setTrialEntryId(undefined), [])

  const state = useMemo(() => (story ? {
    projectId,
    readOnly,
    story,
    variables: story.config.variables,
    saveConfig,
    trialEntryId,
    openTrial,
    closeTrial,
    panel,
    setPanel,
  } : null), [closeTrial, openTrial, panel, projectId, readOnly, saveConfig, story, trialEntryId])
  return { story: state, status }
}

const StoryCanvasContext = createContext<StoryCanvasContextValue | null>(null)

export const StoryCanvasProvider = StoryCanvasContext.Provider

export function useStoryCanvasContext() {
  return useContext(StoryCanvasContext)
}
