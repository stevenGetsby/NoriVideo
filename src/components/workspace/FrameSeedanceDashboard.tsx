'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { AUDIO_SUPPORTED_MODELS, FIRST_LAST_FRAME_MODELS, SEEDANCE_BATCH_MODELS, VIDEO_MODELS } from '@/lib/constants'

interface VideoEnhanceTask {
  id: string
  name: string
  sourceType: string
  taskId: string | null
  requestId: string | null
  status: string
  error: string | null
  uploadedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

interface VideoEnhanceResponse {
  success?: boolean
  tasks?: VideoEnhanceTask[]
}

const STATUS_CLASS: Record<string, string> = {
  submitted: 'border-[#7eb0ff]/30 bg-[#2c6ef2]/10 text-[#9bc3ff]',
  processing: 'border-[#ffcc66]/35 bg-[#ffcc66]/10 text-[#ffd98a]',
  running: 'border-[#ffcc66]/35 bg-[#ffcc66]/10 text-[#ffd98a]',
  completed: 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]',
  success: 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]',
  failed: 'border-[#ff6b6b]/35 bg-[#ff6b6b]/10 text-[#ff9a9a]',
  canceled: 'border-white/15 bg-white/6 text-white/56',
  cancelled: 'border-white/15 bg-white/6 text-white/56',
}

const CAPABILITY_KEYS = ['models', 'batch', 'firstLast', 'audio', 'history'] as const

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function isSeedanceModel(modelId: string) {
  return modelId.includes('seedance')
}

function normalizeStatus(status: string) {
  return status.toLowerCase()
}

export function FrameSeedanceDashboard() {
  const t = useTranslations('workspace.seedancePanel')
  const [tasks, setTasks] = useState<VideoEnhanceTask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadHistory() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/api/video-enhance?limit=40')
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`.trim())
        }
        const data = (await response.json()) as VideoEnhanceResponse
        if (!cancelled) setTasks(Array.isArray(data.tasks) ? data.tasks : [])
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t('loadFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadHistory()
    return () => {
      cancelled = true
    }
  }, [t])

  const seedanceModels = useMemo(
    () => VIDEO_MODELS.filter((model) => isSeedanceModel(model.value)).slice(0, 8),
    [],
  )

  const modelStats = useMemo(() => {
    const seedanceIds = new Set(seedanceModels.map((model) => model.value))
    const firstLastIds = new Set(FIRST_LAST_FRAME_MODELS.filter((model) => isSeedanceModel(model.value)).map((model) => model.value))
    return {
      models: seedanceIds.size,
      batch: SEEDANCE_BATCH_MODELS.length,
      firstLast: firstLastIds.size,
      audio: AUDIO_SUPPORTED_MODELS.filter(isSeedanceModel).length,
    }
  }, [seedanceModels])

  const taskStats = useMemo(() => {
    const stats = {
      all: tasks.length,
      active: 0,
      completed: 0,
      failed: 0,
    }
    for (const task of tasks) {
      const status = normalizeStatus(task.status)
      if (status === 'submitted' || status === 'processing' || status === 'running') stats.active += 1
      if (status === 'completed' || status === 'success') stats.completed += 1
      if (status === 'failed') stats.failed += 1
    }
    return stats
  }, [tasks])

  const capabilityRows = useMemo(() => CAPABILITY_KEYS.map((key) => {
    if (key === 'history') {
      return {
        key,
        count: taskStats.all,
        status: taskStats.failed > 0 ? 'review' : taskStats.all > 0 ? 'ready' : 'reserved',
        detail: t('capability.details.history', { active: taskStats.active, failed: taskStats.failed }),
      }
    }
    const count = modelStats[key]
    return {
      key,
      count,
      status: count > 0 ? 'ready' : 'reserved',
      detail: t(`capability.details.${key}`),
    }
  }), [modelStats, t, taskStats])

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <section className="rounded-lg border border-white/10 bg-[#151820] p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <AppIcon name="film" className="h-4 w-4 text-[#7eb0ff]" />
              {t('historyTitle')}
            </div>
            <p className="mt-1 text-xs leading-5 text-white/45">{t('historySubtitle')}</p>
          </div>
          <Link
            href={{ pathname: '/video-enhance' }}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#2c6ef2] px-3 text-sm font-semibold text-white hover:bg-[#1f5edd]"
          >
            <AppIcon name="video" className="h-4 w-4" />
            {t('openEnhance')}
          </Link>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-2 text-center">
          {(['all', 'active', 'completed', 'failed'] as const).map((key) => (
            <div key={key} className="rounded-md border border-white/10 bg-white/4 px-3 py-2">
              <div className="text-base font-bold text-white">{taskStats[key]}</div>
              <div className="mt-0.5 text-[11px] text-white/42">{t(`taskStats.${key}`)}</div>
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
                {t('capabilityTitle')}
              </div>
              <p className="mt-1 text-xs leading-5 text-white/40">{t('capabilitySubtitle')}</p>
            </div>
            <span className="w-fit rounded border border-white/10 bg-[#10131b] px-2 py-1 text-[11px] font-medium text-white/42">
              {t('capability.local')}
            </span>
          </div>
          <div className="grid grid-cols-[.8fr_.55fr_.55fr_1.2fr] gap-2 border-b border-white/10 bg-[#10131b] px-3 py-2 text-[11px] font-medium text-white/42">
            <div>{t('capability.columns.module')}</div>
            <div>{t('capability.columns.status')}</div>
            <div>{t('capability.columns.count')}</div>
            <div>{t('capability.columns.detail')}</div>
          </div>
          <div className="divide-y divide-white/8">
            {capabilityRows.map((row) => (
              <div key={row.key} className="grid grid-cols-[.8fr_.55fr_.55fr_1.2fr] gap-2 px-3 py-3 text-xs">
                <div className="truncate font-medium text-white/74">{t(`capability.modules.${row.key}`)}</div>
                <div>
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] ${
                    row.status === 'ready'
                      ? 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                      : row.status === 'review'
                        ? 'border-[#ffd98a]/30 bg-[#ffd98a]/10 text-[#ffd98a]'
                        : 'border-white/10 bg-white/5 text-white/38'
                  }`}>
                    {t(`capability.status.${row.status}`)}
                  </span>
                </div>
                <div className="text-white/56">{row.count}</div>
                <div className="truncate text-white/42">{row.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-white/10">
          <div className="grid grid-cols-[1.2fr_.7fr_.8fr_.9fr] gap-3 border-b border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/45">
            <div>{t('table.name')}</div>
            <div>{t('table.source')}</div>
            <div>{t('table.status')}</div>
            <div>{t('table.updatedAt')}</div>
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-white/52">
              <AppIcon name="loader" className="h-4 w-4 animate-spin" />
              {t('loading')}
            </div>
          ) : tasks.length === 0 ? (
            <div className="px-3 py-6 text-sm text-white/45">{t('empty')}</div>
          ) : (
            <div className="divide-y divide-white/8">
              {tasks.slice(0, 10).map((task) => {
                const status = normalizeStatus(task.status)
                return (
                  <div key={task.id} className="grid grid-cols-[1.2fr_.7fr_.8fr_.9fr] gap-3 px-3 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-white/78">{task.name}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-white/32">{task.taskId || task.requestId || task.id}</div>
                    </div>
                    <div className="text-white/58">{task.sourceType}</div>
                    <div>
                      <span className={`inline-flex rounded border px-2 py-1 text-xs ${STATUS_CLASS[status] || STATUS_CLASS.canceled}`}>
                        {status}
                      </span>
                    </div>
                    <div className="text-xs text-white/45">{formatDate(task.updatedAt || task.finishedAt || task.uploadedAt)}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <aside className="space-y-5">
        <section className="rounded-lg border border-white/10 bg-[#151820] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="cpu" className="h-4 w-4 text-[#7eb0ff]" />
            {t('modelsTitle')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['models', 'batch', 'firstLast', 'audio'] as const).map((key) => (
              <div key={key} className="rounded-md border border-white/10 bg-white/4 px-3 py-2">
                <div className="text-lg font-bold text-white">{modelStats[key]}</div>
                <div className="text-[11px] text-white/42">{t(`modelStats.${key}`)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#151820] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="badgeCheck" className="h-4 w-4 text-[#7eb0ff]" />
            {t('presetTitle')}
          </div>
          <div className="space-y-2">
            {seedanceModels.map((model) => (
              <div key={model.value} className="rounded-md border border-white/10 bg-white/4 px-3 py-2">
                <div className="text-sm font-medium text-white/76">{model.label}</div>
                <div className="mt-1 truncate font-mono text-[11px] text-white/34">{model.value}</div>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  )
}
