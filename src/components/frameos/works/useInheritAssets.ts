'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FrameosMaterialItem } from '../materials/contracts'
import { fetchAllFrameosMaterials } from '../materials/fetch-all-materials'
import {
  clearInheritMaterials,
  defaultInheritSelection,
  inheritSubmitIssue,
  isInheritableMaterial,
  previousInheritSource,
  selectInheritMaterials,
  toggleInheritSelection,
  type InheritMode,
  type InheritSourceOption,
} from './inherit-sources'

interface LibraryState {
  sourceId: string
  items: FrameosMaterialItem[]
  error: string | null
  done: boolean
}

const NO_ITEMS: FrameosMaterialItem[] = []

function useInheritableMaterials(sourceProjectId: string) {
  const [state, setState] = useState<LibraryState>({ sourceId: '', items: NO_ITEMS, error: null, done: false })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!sourceProjectId) return
    const controller = new AbortController()
    setState({ sourceId: sourceProjectId, items: NO_ITEMS, error: null, done: false })
    const params = new URLSearchParams({ projectId: sourceProjectId, scope: 'project', limit: '500', sync: '1' })
    void fetchAllFrameosMaterials(params, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        setState({ sourceId: sourceProjectId, items: items.filter(isInheritableMaterial), error: null, done: true })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error && error.message ? error.message : '请稍后重试'
        setState({ sourceId: sourceProjectId, items: NO_ITEMS, error: `读取作品资产失败：${message}`, done: true })
      })
    return () => controller.abort()
  }, [sourceProjectId, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const current = state.sourceId === sourceProjectId
  return {
    items: current ? state.items : NO_ITEMS,
    error: current ? state.error : null,
    loading: Boolean(sourceProjectId) && !(current && state.done),
    retry,
  }
}

/**
 * State of the "继承资产" choice in the create dialog. The selection is derived:
 * until the person touches it, every loaded asset (up to the cap) is selected,
 * and a selection made for one source never leaks into another.
 */
export function useInheritAssets({
  sources,
  currentWorkId,
}: {
  sources: readonly InheritSourceOption[]
  currentWorkId: string
}) {
  const previous = useMemo(() => previousInheritSource(sources, currentWorkId), [sources, currentWorkId])
  const [mode, setMode] = useState<InheritMode>('none')
  const [chosenId, setChosenId] = useState('')
  const [touched, setTouched] = useState<{ sourceId: string; ids: string[] } | null>(null)

  const sourceProjectId = mode === 'previous' ? previous?.projectId ?? '' : mode === 'chosen' ? chosenId : ''
  const library = useInheritableMaterials(sourceProjectId)

  const selectedIds = useMemo(() => {
    if (!sourceProjectId || library.loading || library.error) return []
    if (touched?.sourceId !== sourceProjectId) return defaultInheritSelection(library.items)
    const loaded = new Set(library.items.map((item) => item.id))
    return touched.ids.filter((id) => loaded.has(id))
  }, [library.error, library.items, library.loading, sourceProjectId, touched])

  const commit = (ids: string[]) => setTouched({ sourceId: sourceProjectId, ids })
  const toggle = (id: string) => commit(toggleInheritSelection(selectedIds, id))
  const selectVisible = (visible: readonly FrameosMaterialItem[]) => commit(selectInheritMaterials(selectedIds, visible))
  const clearVisible = (visible: readonly FrameosMaterialItem[]) => commit(clearInheritMaterials(selectedIds, visible))

  const issue = inheritSubmitIssue({
    mode,
    sourceProjectId,
    loading: library.loading,
    error: library.error,
    selectedCount: selectedIds.length,
  })
  const request = mode !== 'none' && !issue ? { sourceProjectId, materialIds: selectedIds } : null

  return {
    mode,
    setMode,
    previous,
    chosenId,
    setChosenId,
    sourceProjectId,
    items: library.items,
    loading: library.loading,
    error: library.error,
    retry: library.retry,
    selectedIds,
    toggle,
    selectVisible,
    clearVisible,
    issue,
    request,
  }
}

export type InheritAssetsState = ReturnType<typeof useInheritAssets>
