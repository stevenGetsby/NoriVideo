'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { parseCustomArtStyles, type CustomArtStyle } from '@/lib/constants'

export function useCustomArtStyles() {
  const [customStyles, setCustomStyles] = useState<CustomArtStyle[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await apiFetch('/api/user-preference')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setCustomStyles(parseCustomArtStyles(data.preference?.customArtStyles))
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const save = useCallback(async (styles: CustomArtStyle[]) => {
    setCustomStyles(styles)
    await apiFetch('/api/user-preference', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customArtStyles: JSON.stringify(styles) }),
    })
  }, [])

  const addStyle = useCallback(async (style: Omit<CustomArtStyle, 'id'>) => {
    const id = crypto.randomUUID().slice(0, 8)
    const newStyle: CustomArtStyle = { id, ...style }
    const next = [...customStyles, newStyle]
    await save(next)
    return newStyle
  }, [customStyles, save])

  const updateStyle = useCallback(async (id: string, updates: Partial<Omit<CustomArtStyle, 'id'>>) => {
    const next = customStyles.map(s => s.id === id ? { ...s, ...updates } : s)
    await save(next)
  }, [customStyles, save])

  const deleteStyle = useCallback(async (id: string) => {
    const next = customStyles.filter(s => s.id !== id)
    await save(next)
  }, [customStyles, save])

  return { customStyles, loading, addStyle, updateStyle, deleteStyle }
}
