'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import type { AssetKind, AssetSummary } from '@/lib/assets/contracts'
import { groupAssetsByKind } from '@/lib/assets/grouping'

interface AssetsResponse {
  assets?: AssetSummary[]
}

function countVisualRenders(asset: AssetSummary) {
  if (asset.kind === 'voice') return 0
  return asset.variants.reduce((sum, variant) => sum + variant.renders.filter((render) => render.imageUrl || render.media).length, 0)
}

function getPreviewUrl(asset: AssetSummary) {
  if (asset.kind === 'voice') return null
  for (const variant of asset.variants) {
    const selected = variant.renders.find((render) => render.isSelected && (render.imageUrl || render.media?.url))
    if (selected) return selected.imageUrl || selected.media?.url || null
    const first = variant.renders.find((render) => render.imageUrl || render.media?.url)
    if (first) return first.imageUrl || first.media?.url || null
  }
  return null
}

function hasPreview(asset: AssetSummary) {
  if (asset.kind === 'voice') return !!(asset.voiceMeta.media?.url || asset.voiceMeta.customVoiceUrl || asset.voiceMeta.voiceId)
  return !!getPreviewUrl(asset)
}

function getDescription(asset: AssetSummary) {
  if (asset.kind === 'character') return asset.introduction || asset.profileData || ''
  if (asset.kind === 'location' || asset.kind === 'prop') return asset.summary || ''
  return asset.voiceMeta.description || asset.voiceMeta.voicePrompt || ''
}

function isRunning(asset: AssetSummary) {
  if (asset.taskState.isRunning) return true
  if (asset.kind === 'character' && asset.profileTaskState.isRunning) return true
  if (asset.kind === 'voice') return false
  return asset.variants.some((variant) => variant.taskState.isRunning || variant.renders.some((render) => render.taskState.isRunning))
}

function hasError(asset: AssetSummary) {
  if (asset.taskState.lastError) return true
  if (asset.kind === 'character' && asset.profileTaskState.lastError) return true
  if (asset.kind === 'voice') return false
  return asset.variants.some((variant) => variant.taskState.lastError || variant.renders.some((render) => render.taskState.lastError))
}

export function FrameMaterialDashboard() {
  const t = useTranslations('workspace.materialPanel')
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadAssets() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/api/assets?scope=global')
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`.trim())
        }
        const data = (await response.json()) as AssetsResponse
        if (!cancelled) setAssets(Array.isArray(data.assets) ? data.assets : [])
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t('loadFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadAssets()
    return () => {
      cancelled = true
    }
  }, [t])

  const grouped = useMemo(() => groupAssetsByKind(assets), [assets])

  const stats = useMemo(() => {
    const visualAssets = assets.filter((asset) => asset.family === 'visual').length
    const audioAssets = assets.filter((asset) => asset.family === 'audio').length
    return {
      total: assets.length,
      visual: visualAssets,
      audio: audioAssets,
      renders: assets.reduce((sum, asset) => sum + countVisualRenders(asset), 0),
      running: assets.filter(isRunning).length,
      failed: assets.filter(hasError).length,
    }
  }, [assets])

  const recentAssets = useMemo(
    () => [...assets].slice(0, 10),
    [assets],
  )

  const kindRows: Array<{ key: AssetKind; count: number; icon: 'user' | 'image' | 'package' | 'audioWave' }> = [
    { key: 'character', count: grouped.character.length, icon: 'user' },
    { key: 'location', count: grouped.location.length, icon: 'image' },
    { key: 'prop', count: grouped.prop.length, icon: 'package' },
    { key: 'voice', count: grouped.voice.length, icon: 'audioWave' },
  ]

  const readinessRows = useMemo(() => kindRows.map((row) => {
    const items = grouped[row.key]
    const ready = items.filter((asset) => hasPreview(asset) && !isRunning(asset) && !hasError(asset)).length
    const missingPreview = items.filter((asset) => !hasPreview(asset)).length
    const running = items.filter(isRunning).length
    const failed = items.filter(hasError).length
    const latest = items[0]
    return {
      key: row.key,
      total: items.length,
      ready,
      missingPreview,
      running,
      failed,
      latestName: latest?.name || t('readiness.none'),
    }
  }), [grouped, kindRows, t])

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <section className="rounded-lg border border-white/10 bg-[#151820] p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <AppIcon name="package" className="h-4 w-4 text-[#7eb0ff]" />
              {t('title')}
            </div>
            <p className="mt-1 text-xs leading-5 text-white/45">{t('subtitle')}</p>
          </div>
          <Link
            href={{ pathname: '/asset-hub' }}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#2c6ef2] px-3 text-sm font-semibold text-white hover:bg-[#1f5edd]"
          >
            <AppIcon name="folderHeart" className="h-4 w-4" />
            {t('openAssetHub')}
          </Link>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 text-center md:grid-cols-6">
          {(['total', 'visual', 'audio', 'renders', 'running', 'failed'] as const).map((key) => (
            <div key={key} className="rounded-md border border-white/10 bg-white/4 px-3 py-2">
              <div className="text-base font-bold text-white">{stats[key]}</div>
              <div className="mt-0.5 text-[11px] text-white/42">{t(`stats.${key}`)}</div>
            </div>
          ))}
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 px-3 py-2 text-sm text-[#ffb1b1]">
            {t('loadFailed')}: {error}
          </div>
        ) : null}

        <div className="mb-4 overflow-hidden rounded-md border border-white/10">
          <div className="flex flex-col gap-1 border-b border-white/10 bg-white/5 px-3 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white/78">
                <AppIcon name="clipboardCheck" className="h-4 w-4 text-[#9bc3ff]" />
                {t('readinessTitle')}
              </div>
              <p className="mt-1 text-xs leading-5 text-white/40">{t('readinessSubtitle')}</p>
            </div>
            <span className="w-fit rounded border border-white/10 bg-[#10131b] px-2 py-1 text-[11px] font-medium text-white/42">
              {t('readiness.local')}
            </span>
          </div>
          <div className="grid grid-cols-[.7fr_.45fr_.45fr_.55fr_.55fr_.45fr_1fr] gap-2 border-b border-white/10 bg-[#10131b] px-3 py-2 text-[11px] font-medium text-white/42">
            <div>{t('readiness.columns.kind')}</div>
            <div>{t('readiness.columns.total')}</div>
            <div>{t('readiness.columns.ready')}</div>
            <div>{t('readiness.columns.missingPreview')}</div>
            <div>{t('readiness.columns.running')}</div>
            <div>{t('readiness.columns.failed')}</div>
            <div>{t('readiness.columns.latest')}</div>
          </div>
          <div className="divide-y divide-white/8">
            {readinessRows.map((row) => (
              <div key={row.key} className="grid grid-cols-[.7fr_.45fr_.45fr_.55fr_.55fr_.45fr_1fr] gap-2 px-3 py-3 text-xs">
                <div className="truncate font-medium text-white/74">{t(`kinds.${row.key}`)}</div>
                <div className="text-white/56">{row.total}</div>
                <div className="font-medium text-[#8ff0b9]">{row.ready}</div>
                <div className={row.missingPreview > 0 ? 'font-medium text-[#ffd98a]' : 'text-white/42'}>{row.missingPreview}</div>
                <div className={row.running > 0 ? 'font-medium text-[#ffd98a]' : 'text-white/42'}>{row.running}</div>
                <div className={row.failed > 0 ? 'font-medium text-[#ff9a9a]' : 'text-white/42'}>{row.failed}</div>
                <div className="truncate text-white/42">{row.latestName}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-white/10">
          <div className="grid grid-cols-[1.2fr_.7fr_.7fr_1fr] gap-3 border-b border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/45">
            <div>{t('table.asset')}</div>
            <div>{t('table.kind')}</div>
            <div>{t('table.renders')}</div>
            <div>{t('table.status')}</div>
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-white/52">
              <AppIcon name="loader" className="h-4 w-4 animate-spin" />
              {t('loading')}
            </div>
          ) : recentAssets.length === 0 ? (
            <div className="px-3 py-6 text-sm text-white/45">{t('empty')}</div>
          ) : (
            <div className="divide-y divide-white/8">
              {recentAssets.map((asset) => {
                const previewUrl = getPreviewUrl(asset)
                return (
                  <div key={`${asset.kind}-${asset.id}`} className="grid grid-cols-[1.2fr_.7fr_.7fr_1fr] gap-3 px-3 py-3 text-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-white/5">
                        {previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <AppIcon name={asset.kind === 'voice' ? 'audioWave' : 'image'} className="h-4 w-4 text-white/36" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white/78">{asset.name}</div>
                        <div className="mt-0.5 line-clamp-1 text-xs text-white/36">{getDescription(asset) || t('noDescription')}</div>
                      </div>
                    </div>
                    <div className="text-white/58">{t(`kinds.${asset.kind}`)}</div>
                    <div className="text-white/58">{countVisualRenders(asset)}</div>
                    <div className="flex flex-wrap gap-1">
                      {isRunning(asset) ? (
                        <span className="rounded border border-[#ffcc66]/35 bg-[#ffcc66]/10 px-2 py-0.5 text-xs text-[#ffd98a]">{t('status.running')}</span>
                      ) : null}
                      {hasError(asset) ? (
                        <span className="rounded border border-[#ff6b6b]/35 bg-[#ff6b6b]/10 px-2 py-0.5 text-xs text-[#ff9a9a]">{t('status.failed')}</span>
                      ) : null}
                      {!isRunning(asset) && !hasError(asset) ? (
                        <span className="rounded border border-[#45d483]/30 bg-[#45d483]/10 px-2 py-0.5 text-xs text-[#8ff0b9]">{t('status.ready')}</span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <aside className="rounded-lg border border-white/10 bg-[#151820] p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <AppIcon name="folderOpen" className="h-4 w-4 text-[#7eb0ff]" />
          {t('groupsTitle')}
        </div>
        <div className="space-y-2">
          {kindRows.map((row) => (
            <div key={row.key} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-white/76">
                  <AppIcon name={row.icon} className="h-4 w-4 text-white/42" />
                  {t(`kinds.${row.key}`)}
                </div>
                <div className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/48">{row.count}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
