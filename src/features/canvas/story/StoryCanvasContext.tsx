'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Film, GitBranch, ListTree, Play, Sparkles, type IconComponent } from '@/components/ui/icons'
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
}

export const STORY_NODE_HUES: Record<StoryNodeType, string> = {
  story_entry: '#34d399',
  story_scene: '#a78bfa',
  story_choice: '#f472b6',
  story_condition: '#38bdf8',
  story_exit: '#fb923c',
  story_ending: '#fbbf24',
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

export type StoryCanvasPanel = 'variables' | 'checks' | null

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
  saveVariables: (variables: StoryVariable[]) => Promise<void>
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

  const saveVariables = useCallback(async (variables: StoryVariable[]) => {
    if (!story) return
    const response = await apiFetch(`/api/interactive/${encodeURIComponent(story.workId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { variables } }),
    })
    if (!response.ok) throw new Error(await storyErrorMessage(response, '保存全局变量失败'))
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
    saveVariables,
    trialEntryId,
    openTrial,
    closeTrial,
    panel,
    setPanel,
  } : null), [closeTrial, openTrial, panel, projectId, readOnly, saveVariables, story, trialEntryId])
}

const StoryCanvasContext = createContext<StoryCanvasContextValue | null>(null)

export const StoryCanvasProvider = StoryCanvasContext.Provider

export function useStoryCanvasContext() {
  return useContext(StoryCanvasContext)
}
