'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'

interface Episode {
  id: string
  episodeNumber: number
  name: string
  description: string | null
  novelText: string | null
  updatedAt: string
}

interface ProjectData {
  id: string
  name: string
  description: string | null
  novelPromotionData?: {
    characters?: unknown[]
    locations?: unknown[]
    props?: unknown[]
    episodes?: Episode[]
  } | null
}

interface ProjectResponse {
  project?: ProjectData
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function countText(value?: string | null) {
  return (value || '').trim().length
}

function sanitizePreview(value: string) {
  if (/agent/i.test(value)) return ''
  return value
    .replace(/\[[^\]]*agent[^\]]*\]/gi, '')
    .replace(/【[^】]*agent[^】]*】/gi, '')
    .replace(/\{[^{}]*agent[^{}]*\}/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function FrameWriterRedrawDashboard({ scriptId }: { scriptId: string }) {
  const t = useTranslations('workspace.redrawPanel')
  const [project, setProject] = useState<ProjectData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadProject() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await apiFetch(`/api/projects/${scriptId}/data`)
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
        const data = (await response.json()) as ProjectResponse
        if (!cancelled) setProject(data.project || null)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t('loadFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadProject()
    return () => {
      cancelled = true
    }
  }, [scriptId, t])

  const episodes = useMemo(
    () => [...(project?.novelPromotionData?.episodes || [])].sort((a, b) => a.episodeNumber - b.episodeNumber),
    [project?.novelPromotionData?.episodes],
  )

  const stats = useMemo(() => ({
    episodes: episodes.length,
    words: episodes.reduce((sum, episode) => sum + countText(episode.novelText), 0),
    characters: project?.novelPromotionData?.characters?.length || 0,
    locations: (project?.novelPromotionData?.locations?.length || 0) + (project?.novelPromotionData?.props?.length || 0),
  }), [episodes, project?.novelPromotionData])

  const firstPreview = sanitizePreview(episodes.find((episode) => episode.novelText)?.novelText || project?.description || '')

  const readinessRows = useMemo(() => {
    const sourceWords = countText(firstPreview)
    const episodeWords = episodes.reduce((sum, episode) => sum + countText(sanitizePreview(episode.novelText || '')), 0)
    const assetCount = stats.characters + stats.locations
    return [
      {
        key: 'source',
        ready: sourceWords > 0,
        count: sourceWords,
        hint: sourceWords > 0 ? t('readiness.hints.sourceReady') : t('readiness.hints.sourceMissing'),
      },
      {
        key: 'structure',
        ready: episodes.length > 0,
        count: episodes.length,
        hint: episodes.length > 0 ? t('readiness.hints.structureReady', { count: episodes.length }) : t('readiness.hints.structureMissing'),
      },
      {
        key: 'assets',
        ready: assetCount > 0,
        count: assetCount,
        hint: assetCount > 0 ? t('readiness.hints.assetsReady', { count: assetCount }) : t('readiness.hints.assetsMissing'),
      },
      {
        key: 'sync',
        ready: episodeWords > 0 && episodes.length > 0,
        count: episodeWords,
        hint: episodeWords > 0 ? t('readiness.hints.syncReady') : t('readiness.hints.syncMissing'),
      },
    ]
  }, [episodes, firstPreview, stats.characters, stats.locations, t])

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <section className="rounded-lg border border-white/10 bg-[#151820] p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <AppIcon name="wandOff" className="h-4 w-4 text-[#7eb0ff]" />
              {t('title')}
            </div>
            <p className="mt-1 text-xs leading-5 text-white/45">{t('subtitle')}</p>
          </div>
          <Link
            href={`/workspace/${scriptId}/script`}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#2c6ef2] px-3 text-sm font-semibold text-white hover:bg-[#1f5edd]"
          >
            <AppIcon name="fileText" className="h-4 w-4" />
            {t('openScript')}
          </Link>
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 px-3 py-2 text-sm text-[#ffb1b1]">
            {t('loadFailed')}: {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/4 px-3 py-6 text-sm text-white/52">
            <AppIcon name="loader" className="h-4 w-4 animate-spin" />
            {t('loading')}
          </div>
        ) : !project ? (
          <div className="rounded-md border border-white/10 bg-white/4 px-3 py-6 text-sm text-white/45">{t('empty')}</div>
        ) : (
          <>
            <div className="mb-4 rounded-lg border border-white/10 bg-white/4 p-4">
              <div className="text-lg font-semibold text-white">{project.name}</div>
              <div className="mt-2 line-clamp-3 text-sm leading-6 text-white/50">{firstPreview || t('noPreview')}</div>
            </div>

            <div className="mb-4 grid grid-cols-4 gap-2 text-center">
              {(['episodes', 'words', 'characters', 'locations'] as const).map((key) => (
                <div key={key} className="rounded-md border border-white/10 bg-white/4 px-3 py-2">
                  <div className="text-base font-bold text-white">{stats[key]}</div>
                  <div className="mt-0.5 text-[11px] text-white/42">{t(`stats.${key}`)}</div>
                </div>
              ))}
            </div>

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
              <div className="grid grid-cols-[.8fr_.55fr_.6fr_1.2fr] gap-2 border-b border-white/10 bg-[#10131b] px-3 py-2 text-[11px] font-medium text-white/42">
                <div>{t('readiness.columns.item')}</div>
                <div>{t('readiness.columns.status')}</div>
                <div>{t('readiness.columns.count')}</div>
                <div>{t('readiness.columns.hint')}</div>
              </div>
              <div className="divide-y divide-white/8">
                {readinessRows.map((row) => (
                  <div key={row.key} className="grid grid-cols-[.8fr_.55fr_.6fr_1.2fr] gap-2 px-3 py-3 text-xs">
                    <div className="truncate font-medium text-white/74">{t(`readiness.items.${row.key}`)}</div>
                    <div>
                      <span className={`rounded border px-1.5 py-0.5 text-[11px] ${
                        row.ready
                          ? 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                          : 'border-[#ffd98a]/30 bg-[#ffd98a]/10 text-[#ffd98a]'
                      }`}>
                        {row.ready ? t('readiness.status.ready') : t('readiness.status.review')}
                      </span>
                    </div>
                    <div className="text-white/56">{row.count}</div>
                    <div className="truncate text-white/42">{row.hint}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-md border border-white/10">
              <div className="grid grid-cols-[1fr_.7fr_.9fr] gap-3 border-b border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/45">
                <div>{t('table.episode')}</div>
                <div>{t('table.words')}</div>
                <div>{t('table.updatedAt')}</div>
              </div>
              {episodes.length === 0 ? (
                <div className="px-3 py-6 text-sm text-white/45">{t('noEpisodes')}</div>
              ) : (
                <div className="divide-y divide-white/8">
                  {episodes.slice(0, 8).map((episode) => (
                    <div key={episode.id} className="grid grid-cols-[1fr_.7fr_.9fr] gap-3 px-3 py-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white/78">{episode.name || t('episodeFallback', { number: episode.episodeNumber })}</div>
                        <div className="mt-0.5 line-clamp-1 text-xs text-white/36">{sanitizePreview(episode.description || episode.novelText || '') || t('noPreview')}</div>
                      </div>
                      <div className="text-white/58">{countText(episode.novelText)}</div>
                      <div className="text-xs text-white/45">{formatDate(episode.updatedAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <aside className="rounded-lg border border-white/10 bg-[#151820] p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <AppIcon name="clipboardCheck" className="h-4 w-4 text-[#7eb0ff]" />
          {t('checklistTitle')}
        </div>
        <div className="space-y-2">
          {(['source', 'structure', 'assets', 'sync'] as const).map((step, index) => (
            <div key={step} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded bg-[#2c6ef2]/16 text-xs font-bold text-[#8ab8ff]">
                  {index + 1}
                </div>
                <div>
                  <div className="text-sm font-medium text-white/76">{t(`checklist.${step}.title`)}</div>
                  <div className="mt-0.5 text-xs text-white/38">{t(`checklist.${step}.hint`)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
