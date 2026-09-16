'use client'

import { createContext, useContext } from 'react'
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
  | 'retry_generation_task'
  | 'superresolve'
  | 'panorama_720'
  | 'panorama_preview'
  | 'image_edit'
  | 'grid_split'
  | 'lens_focus'
  | 'subtitle_erase'
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
  removeNodes: (nodeIds: string[]) => void
  duplicateNodes: (nodeIds: string[]) => void
  runNodeAction: (nodeId: string, action: CanvasNodeAction) => void
  listPlaylistVideoSources: () => CanvasPlaylistVideoSource[]
  loadPlaylistRender: (nodeId: string) => Promise<CanvasPlaylistRenderSummary>
  startPlaylistRender: (nodeId: string) => Promise<CanvasPlaylistRenderSummary>
  loadPlaylistReview: (nodeId: string) => Promise<CanvasPlaylistReviewSummary>
  submitPlaylistReview: (nodeId: string) => Promise<CanvasPlaylistReviewSummary>
}

const CanvasEditorContext = createContext<CanvasEditorContextValue | null>(null)

export const CanvasEditorProvider = CanvasEditorContext.Provider

export function useCanvasEditor() {
  const value = useContext(CanvasEditorContext)
  if (!value) throw new Error('CanvasEditorProvider is missing')
  return value
}
