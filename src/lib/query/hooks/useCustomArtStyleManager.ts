'use client'

import { useCallback, useMemo, useState } from 'react'
import type { CustomArtStyle } from '@/lib/constants'
import { useCustomArtStyles } from './useCustomArtStyles'

interface UseCustomArtStyleManagerParams {
  selectedValue?: string | null
  onSelect?: (value: string) => void
  fallbackValue?: string
}

interface SaveCustomArtStyleInput {
  label: string
  promptZh: string
  promptEn: string
}

export function useCustomArtStyleManager({
  selectedValue,
  onSelect,
  fallbackValue = 'american-comic',
}: UseCustomArtStyleManagerParams) {
  const [customStyleModalOpen, setCustomStyleModalOpen] = useState(false)
  const [editingCustomStyleId, setEditingCustomStyleId] = useState<string | null>(null)
  const { customStyles, loading, addStyle, updateStyle, deleteStyle } = useCustomArtStyles()

  const customStyleOptions = useMemo(
    () => customStyles.map((style) => ({ value: `custom:${style.id}`, label: style.label })),
    [customStyles],
  )

  const editingCustomStyle = useMemo<CustomArtStyle | null>(
    () => editingCustomStyleId
      ? customStyles.find((style) => style.id === editingCustomStyleId) ?? null
      : null,
    [customStyles, editingCustomStyleId],
  )

  const openAddCustomStyle = useCallback(() => {
    setEditingCustomStyleId(null)
    setCustomStyleModalOpen(true)
  }, [])

  const openEditCustomStyle = useCallback((value: string) => {
    const id = value.startsWith('custom:') ? value.slice(7) : value
    setEditingCustomStyleId(id)
    setCustomStyleModalOpen(true)
  }, [])

  const closeCustomStyleModal = useCallback(() => {
    setCustomStyleModalOpen(false)
    setEditingCustomStyleId(null)
  }, [])

  const removeCustomStyle = useCallback(async (value: string) => {
    const id = value.startsWith('custom:') ? value.slice(7) : value
    await deleteStyle(id)
    if (selectedValue === value) {
      onSelect?.(fallbackValue)
    }
  }, [deleteStyle, fallbackValue, onSelect, selectedValue])

  const saveCustomStyle = useCallback(async (data: SaveCustomArtStyleInput) => {
    if (editingCustomStyleId) {
      await updateStyle(editingCustomStyleId, data)
    } else {
      const newStyle = await addStyle(data)
      onSelect?.(`custom:${newStyle.id}`)
    }
    closeCustomStyleModal()
  }, [addStyle, closeCustomStyleModal, editingCustomStyleId, onSelect, updateStyle])

  return {
    customStylesLoading: loading,
    customStyleOptions,
    customStyleModalOpen,
    editingCustomStyle,
    openAddCustomStyle,
    openEditCustomStyle,
    closeCustomStyleModal,
    removeCustomStyle,
    saveCustomStyle,
  }
}
