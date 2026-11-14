'use client'

import { useCallback, useEffect, useState } from 'react'

export type NoriThemePreference = 'dark' | 'light' | 'system'
export type NoriResolvedTheme = 'dark' | 'light'

export function systemTheme(): NoriResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyNoriTheme(preference: NoriThemePreference) {
  const root = document.documentElement
  const resolved = preference === 'system' ? systemTheme() : preference
  root.dataset.noriThemePref = preference
  root.dataset.noriTheme = resolved
  document.cookie = `nori-theme=${preference}; Path=/; Max-Age=31536000; SameSite=Lax`
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => { meta.content = resolved === 'light' ? '#f5f6fa' : '#0d0d0d' })
}

export function useNoriTheme() {
  const [preference, setPreferenceState] = useState<NoriThemePreference>('dark')
  const [resolved, setResolved] = useState<NoriResolvedTheme>('dark')
  useEffect(() => {
    const root = document.documentElement
    const sync = () => {
      const pref = root.dataset.noriThemePref
      setPreferenceState(pref === 'light' || pref === 'system' ? pref : 'dark')
      setResolved(root.dataset.noriTheme === 'light' ? 'light' : 'dark')
    }
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-nori-theme', 'data-nori-theme-pref'] })
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const change = () => { if (root.dataset.noriThemePref === 'system') root.dataset.noriTheme = systemTheme() }
    media.addEventListener('change', change)
    sync()
    return () => { observer.disconnect(); media.removeEventListener('change', change) }
  }, [])
  const setPreference = useCallback((next: NoriThemePreference) => applyNoriTheme(next), [])
  return { preference, resolved, setPreference }
}
