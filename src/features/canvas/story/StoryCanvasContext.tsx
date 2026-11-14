'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Film, GitBranch, ListTree, Mouse, Play, Sparkles, type IconComponent } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { storyErrorMessage } from '@/features/interactive/story-api-error'
import type { InteractiveStoryConfig, StoryAspectRatio, StoryNodeType, StoryVariable } from '@/lib/interactive/types'

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
  chapters: Array<{ projectId: string; name: string }>
}

export type StoryCanvasPanel = 'gameplay' | 'checks' | null

/** Canvas-level story commands the node cards can trigger. */
export type StoryCanvasActions = {
  /** Opens the "what comes next" menu for a free out-port. */
  quickAdd: (nodeId: string, handleId: string, anchor: { x: number; y: number }) => void
  /** Adds a video / image node above the scene and wires it in as the scene's picture. */
  createSceneMedia: (sceneId: string, type: 'video' | 'image') => void
  focusNode: (nodeId: string) => void
  removeEdge: (edgeId: string) => void
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

/** Loads the 影游 a chapter canvas belongs to; null for ordinary 作品. */
export function useStoryCanvas(projectId: string, readOnly: boolean): StoryCanvasState | null {
  const [story, setStory] = useState<StoryCanvasInfo | null>(null)
  const [trialEntryId, setTrialEntryId] = useState<string | null | undefined>(undefined)
  const [panel, setPanel] = useState<StoryCanvasPanel>(null)

  useEffect(() => {
    let cancelled = false
    setStory(null)
    void apiFetch(`/api/interactive?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { story?: StoryCanvasInfo | null } | null) => { if (!cancelled) setStory(payload?.story ?? null) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [projectId])

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

  return useMemo(() => (story ? {
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
}

const StoryCanvasContext = createContext<StoryCanvasContextValue | null>(null)

export const StoryCanvasProvider = StoryCanvasContext.Provider

export function useStoryCanvasContext() {
  return useContext(StoryCanvasContext)
}
