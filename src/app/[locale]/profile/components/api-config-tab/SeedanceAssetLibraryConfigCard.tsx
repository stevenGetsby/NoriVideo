'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { AppIcon } from '@/components/ui/icons'

interface ConfigState {
  accessKeyId: string
  secretAccessKey: string
  projectName: string
  configured: boolean
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const EMPTY_CONFIG: ConfigState = {
  accessKeyId: '',
  secretAccessKey: '',
  projectName: 'default',
  configured: false,
}

export function SeedanceAssetLibraryConfigCard() {
  const [config, setConfig] = useState<ConfigState>(EMPTY_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadConfig() {
      try {
        const response = await apiFetch('/api/user/seedance-assets-config')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (cancelled) return
        setConfig({
          accessKeyId: typeof data.accessKeyId === 'string' ? data.accessKeyId : '',
          secretAccessKey: typeof data.secretAccessKey === 'string' ? data.secretAccessKey : '',
          projectName: typeof data.projectName === 'string' && data.projectName.trim() ? data.projectName : 'default',
          configured: data.configured === true,
        })
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '加载失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadConfig()
    return () => {
      cancelled = true
    }
  }, [])

  async function saveConfig() {
    setSaveState('saving')
    setError(null)
    try {
      const response = await apiFetch('/api/user/seedance-assets-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          projectName: config.projectName || 'default',
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.message || data?.error?.message || `HTTP ${response.status}`)
      }
      setConfig((current) => ({ ...current, configured: true }))
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2500)
    } catch (saveError) {
      setSaveState('error')
      setError(saveError instanceof Error ? saveError.message : '保存失败')
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <AppIcon name="video" className="h-4 w-4 text-[var(--glass-text-secondary)]" />
            <h3 className="text-sm font-bold text-[var(--glass-text-primary)]">Seedance 2.0 素材库</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${config.configured
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              }`}>
              {config.configured ? '已配置' : '未配置'}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--glass-text-tertiary)]">
            用 AK/SK 调用火山 Ark 素材库 API。角色图入库成功后，分镜视频 reference 会优先使用 asset:// 资产 ID。
          </p>
        </div>
        <button
          onClick={saveConfig}
          disabled={loading || saveState === 'saving'}
          className="glass-btn-base glass-btn-primary h-8 shrink-0 px-3 text-xs font-semibold disabled:opacity-50"
        >
          {saveState === 'saving' ? (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <AppIcon name="check" className="h-3.5 w-3.5" />
          )}
          <span>{saveState === 'saved' ? '已保存' : '保存'}</span>
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_160px]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[var(--glass-text-secondary)]">Access Key ID</span>
          <input
            value={config.accessKeyId}
            onChange={(event) => setConfig((current) => ({ ...current, accessKeyId: event.target.value }))}
            placeholder="AKLT..."
            className="glass-input-base w-full px-3 py-2 text-xs font-mono"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[var(--glass-text-secondary)]">Secret Access Key</span>
          <input
            type="password"
            value={config.secretAccessKey}
            onChange={(event) => setConfig((current) => ({ ...current, secretAccessKey: event.target.value }))}
            placeholder="SK..."
            className="glass-input-base w-full px-3 py-2 text-xs font-mono"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[var(--glass-text-secondary)]">ProjectName</span>
          <input
            value={config.projectName}
            onChange={(event) => setConfig((current) => ({ ...current, projectName: event.target.value }))}
            placeholder="default"
            className="glass-input-base w-full px-3 py-2 text-xs font-mono"
          />
        </label>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-500">
          {error}
        </div>
      )}
    </section>
  )
}
