'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'

interface ProjectStats {
  episodes: number
  images: number
  videos: number
  panels: number
  firstEpisodePreview: string | null
}

interface ProjectSummary {
  id: string
  name: string
  description: string | null
  updatedAt: string
  stats?: ProjectStats
}

interface ProjectsResponse {
  projects?: ProjectSummary[]
  pagination?: {
    total: number
  }
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function readiness(project: ProjectSummary) {
  const episodes = project.stats?.episodes ?? 0
  const panels = project.stats?.panels ?? 0
  if (panels > 0) return 'storyboard'
  if (episodes > 0) return 'script'
  return 'draft'
}

const PREPARATION_KEYS = ['draft', 'script', 'storyboard', 'video'] as const

function sanitizePreview(value: string) {
  if (/agent/i.test(value)) return ''
  return value
    .replace(/\[[^\]]*agent[^\]]*\]/gi, '')
    .replace(/【[^】]*agent[^】]*】/gi, '')
    .replace(/\{[^{}]*agent[^{}]*\}/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function FrameWriterWorkbenchDashboard() {
  const t = useTranslations('workspace.writerPanel')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadProjects() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/api/projects?page=1&pageSize=8')
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`.trim())
        }
        const data = (await response.json()) as ProjectsResponse
        if (!cancelled) {
          setProjects(Array.isArray(data.projects) ? data.projects : [])
          setTotal(data.pagination?.total ?? (Array.isArray(data.projects) ? data.projects.length : 0))
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t('loadFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadProjects()
    return () => {
      cancelled = true
    }
  }, [t])

  const stats = useMemo(() => ({
    total,
    withScript: projects.filter((project) => (project.stats?.episodes ?? 0) > 0).length,
    storyboards: projects.reduce((sum, project) => sum + (project.stats?.panels ?? 0), 0),
    videos: projects.reduce((sum, project) => sum + (project.stats?.videos ?? 0), 0),
  }), [projects, total])

  const preparationRows = useMemo(() => PREPARATION_KEYS.map((key) => {
    if (key === 'draft') {
      const items = projects.filter((project) => (project.stats?.episodes ?? 0) === 0)
      return { key, count: items.length, latest: items[0], action: '/workspace' }
    }
    if (key === 'script') {
      const items = projects.filter((project) => (project.stats?.episodes ?? 0) > 0 && (project.stats?.panels ?? 0) === 0)
      return { key, count: items.length, latest: items[0], action: items[0] ? `/workspace/${items[0].id}/script` : '/workspace' }
    }
    if (key === 'storyboard') {
      const items = projects.filter((project) => (project.stats?.panels ?? 0) > 0 && (project.stats?.videos ?? 0) === 0)
      return { key, count: items.length, latest: items[0], action: items[0] ? `/workspace/${items[0].id}/storyboard` : '/workspace' }
    }
    const items = projects.filter((project) => (project.stats?.videos ?? 0) > 0)
    return { key, count: items.length, latest: items[0], action: items[0] ? `/workspace/${items[0].id}` : '/workspace' }
  }), [projects])

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <section className="rounded-lg border border-white/10 bg-[#151820] p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <AppIcon name="fileText" className="h-4 w-4 text-[#7eb0ff]" />
              {t('title')}
            </div>
            <p className="mt-1 text-xs leading-5 text-white/45">{t('subtitle')}</p>
          </div>
          <Link
            href={{ pathname: '/workspace' }}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#2c6ef2] px-3 text-sm font-semibold text-white hover:bg-[#1f5edd]"
          >
            <AppIcon name="plus" className="h-4 w-4" />
            {t('newProject')}
          </Link>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-2 text-center">
          {(['total', 'withScript', 'storyboards', 'videos'] as const).map((key) => (
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
                {t('preparationTitle')}
              </div>
              <p className="mt-1 text-xs leading-5 text-white/40">{t('preparationSubtitle')}</p>
            </div>
            <span className="w-fit rounded border border-white/10 bg-[#10131b] px-2 py-1 text-[11px] font-medium text-white/42">
              {t('preparation.local')}
            </span>
          </div>
          <div className="grid grid-cols-[.75fr_.55fr_1fr_.85fr] gap-2 border-b border-white/10 bg-[#10131b] px-3 py-2 text-[11px] font-medium text-white/42">
            <div>{t('preparation.columns.stage')}</div>
            <div>{t('preparation.columns.count')}</div>
            <div>{t('preparation.columns.latest')}</div>
            <div>{t('preparation.columns.action')}</div>
          </div>
          <div className="divide-y divide-white/8">
            {preparationRows.map((row) => (
              <div key={row.key} className="grid grid-cols-[.75fr_.55fr_1fr_.85fr] gap-2 px-3 py-3 text-xs">
                <div className="truncate font-medium text-white/74">{t(`preparation.stages.${row.key}`)}</div>
                <div className={row.count > 0 ? 'font-medium text-[#8ff0b9]' : 'text-white/42'}>{row.count}</div>
                <div className="truncate text-white/42">{row.latest?.name || t('preparation.none')}</div>
                <Link href={row.action} className="truncate text-[#9bc3ff] hover:text-white">
                  {t(`preparation.actions.${row.key}`)}
                </Link>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-white/10">
          <div className="grid grid-cols-[1.3fr_.7fr_.7fr_.9fr] gap-3 border-b border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/45">
            <div>{t('table.project')}</div>
            <div>{t('table.episodes')}</div>
            <div>{t('table.status')}</div>
            <div>{t('table.updatedAt')}</div>
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-white/52">
              <AppIcon name="loader" className="h-4 w-4 animate-spin" />
              {t('loading')}
            </div>
          ) : projects.length === 0 ? (
            <div className="px-3 py-6 text-sm text-white/45">{t('empty')}</div>
          ) : (
            <div className="divide-y divide-white/8">
              {projects.map((project) => {
                const state = readiness(project)
                const preview = sanitizePreview(project.stats?.firstEpisodePreview || project.description || '') || t('noPreview')
                return (
                  <div key={project.id} className="grid grid-cols-[1.3fr_.7fr_.7fr_.9fr] gap-3 px-3 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <Link
                          href={`/workspace/${project.id}/script`}
                          className="truncate font-medium text-white/82 hover:text-white"
                        >
                          {project.name}
                        </Link>
                        <Link
                          href={`/writer-workbench/redraw-v2/${project.id}`}
                          className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-white/45 hover:border-[#2c6ef2]/50 hover:text-white"
                        >
                          {t('redraw')}
                        </Link>
                      </div>
                      <div className="mt-1 line-clamp-1 text-xs text-white/38">{preview}</div>
                    </div>
                    <div className="text-white/58">{project.stats?.episodes ?? 0}</div>
                    <div>
                      <span className={`rounded border px-2 py-0.5 text-xs ${
                        state === 'storyboard'
                          ? 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                          : state === 'script'
                            ? 'border-[#7eb0ff]/30 bg-[#2c6ef2]/10 text-[#9bc3ff]'
                            : 'border-[#ffcc66]/35 bg-[#ffcc66]/10 text-[#ffd98a]'
                      }`}>
                        {t(`readiness.${state}`)}
                      </span>
                    </div>
                    <div className="text-xs text-white/45">{formatDate(project.updatedAt)}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <aside className="rounded-lg border border-white/10 bg-[#151820] p-4">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
          <AppIcon name="bookOpen" className="h-4 w-4 text-[#7eb0ff]" />
          {t('workflowTitle')}
        </div>
        <div className="space-y-2">
          {(['import', 'review', 'redraw', 'sync'] as const).map((step, index) => (
            <div key={step} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded bg-[#2c6ef2]/16 text-xs font-bold text-[#8ab8ff]">
                  {index + 1}
                </div>
                <div>
                  <div className="text-sm font-medium text-white/76">{t(`workflow.${step}.title`)}</div>
                  <div className="mt-0.5 text-xs text-white/38">{t(`workflow.${step}.hint`)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
