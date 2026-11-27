'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { CanvasSaveState } from './components/CanvasChrome'
import type { CanvasFlowNodeData } from './editor-types'
import type { CanvasPlaylistRenderSummary, CanvasPlaylistReviewSummary } from './types'

export type CanvasPlaylistVideoSource = {
  id: string
  title: string
  videoUrl: string | null
  posterUrl: string | null
  materialId: string | null
  durationMs: number | null
}

export type CanvasNodeAction =
  | 'download'
  | 'preview'
  | 'favorite'
  | 'history'
  | 'regenerate'
  | 'cancel_generation'
  | 'superresolve'
  | 'panorama_720'
  | 'panorama_preview'
  | 'image_edit'
  | 'grid_split'
  | 'lens_focus'
  | 'subtitle_erase'
  | 'audio_extract'
  | 'studio_3d'
  | 'arrange_grid'
  | 'arrange_horizontal'
  | 'arrange_vertical'
  | 'save_workflow'

export type CanvasEditorContextValue = {
  readOnly: boolean
  playlistDropTargetId: string | null
  canUndo: boolean
  canRedo: boolean
  saveState: CanvasSaveState
  undo: () => void
  redo: () => void
  saveCanvas: () => Promise<void>
  updateNodeData: (nodeId: string, patch: Partial<CanvasFlowNodeData>, historyLabel?: string) => void
  setTextEditing: (nodeId: string | null) => void
  textEditingNodeId: string | null
  removeNodes: (nodeIds: string[]) => void
  duplicateNodes: (nodeIds: string[]) => void
  runNodeAction: (nodeId: string, action: CanvasNodeAction) => void
  listPlaylistVideoSources: () => CanvasPlaylistVideoSource[]
  loadPlaylistRender: (nodeId: string) => Promise<CanvasPlaylistRenderSummary>
  startPlaylistRender: (nodeId: string) => Promise<CanvasPlaylistRenderSummary>
  loadPlaylistReview: (nodeId: string) => Promise<CanvasPlaylistReviewSummary>
  submitPlaylistReview: (nodeId: string) => Promise<CanvasPlaylistReviewSummary>
}

type CanvasEditorPersistence = Pick<CanvasEditorContextValue, 'canUndo' | 'canRedo' | 'saveState'>
type CanvasEditorVolatileFields = 'playlistDropTargetId' | 'textEditingNodeId'
export type CanvasEditorActions = Omit<CanvasEditorContextValue, keyof CanvasEditorPersistence | CanvasEditorVolatileFields> & {
  playlistDropTargetId?: string | null
  textEditingNodeId?: string | null
}
const CanvasEditorContext = createContext<CanvasEditorActions | null>(null)
const PersistenceContext = createContext<CanvasEditorPersistence | null>(null)
const PlaylistDropTargetContext = createContext<string | null>(null)
const TextEditingNodeContext = createContext<string | null>(null)

export function CanvasEditorProvider({ value, persistence, playlistDropTargetId, textEditingNodeId, children }: {
  value: CanvasEditorActions | CanvasEditorContextValue
  persistence?: CanvasEditorPersistence
  playlistDropTargetId?: string | null
  textEditingNodeId?: string | null
  children: ReactNode
}) {
  // Keep the combined provider contract for fixtures and older embedders.
  // The production graph provides stable actions separately from save status and volatile interaction ids.
  const legacy = 'saveState' in value ? value : null
  const resolvedPlaylistDropTargetId = playlistDropTargetId !== undefined ? playlistDropTargetId : (value.playlistDropTargetId ?? null)
  const resolvedTextEditingNodeId = textEditingNodeId !== undefined ? textEditingNodeId : (value.textEditingNodeId ?? null)
  const actions = useMemo<CanvasEditorActions>(() => {
    if (!('saveState' in value)) return value
    const { saveState: _state, canUndo: _undo, canRedo: _redo, ...actions } = value
    return actions
  }, [value])
  return <CanvasEditorContext.Provider value={actions}>
    <PersistenceContext.Provider value={persistence ?? legacy}>
      <PlaylistDropTargetContext.Provider value={resolvedPlaylistDropTargetId}>
        <TextEditingNodeContext.Provider value={resolvedTextEditingNodeId}>
          {children}
        </TextEditingNodeContext.Provider>
      </PlaylistDropTargetContext.Provider>
    </PersistenceContext.Provider>
  </CanvasEditorContext.Provider>
}

export function useCanvasPlaylistDropTarget() {
  return useContext(PlaylistDropTargetContext)
}

export function useCanvasTextEditingNodeId() {
  return useContext(TextEditingNodeContext)
}

export function useCanvasEditorPersistence() {
  const value = useContext(PersistenceContext)
  if (!value) throw new Error('Canvas editor persistence context is missing')
  return value
}

export function useCanvasEditor() {
  const value = useContext(CanvasEditorContext)
  if (!value) throw new Error('CanvasEditorProvider is missing')
  return value
}

// Kept apart from the editor context so only the boolean flip (not every
// editor state change) re-renders nodes that hide their chrome on multi-select.
const CanvasMultiSelectionContext = createContext(false)

export const CanvasMultiSelectionProvider = CanvasMultiSelectionContext.Provider

export function useCanvasMultiSelection() {
  return useContext(CanvasMultiSelectionContext)
}
