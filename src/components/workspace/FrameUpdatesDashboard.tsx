'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'

interface SystemStatus {
  app: string
  version: string
  bootId: string
  node: string | null
  npm: string | null
  next: string | null
  react: string | null
  checkedAt: string
}

interface UpdateCheckRecord {
  id: string
  checkedAt: string
  version: string
  bootId: string
  status: 'current'
}

interface UpdateCheckResponse {
  success?: boolean
  status?: SystemStatus
  records?: UpdateCheckRecord[]
}

const MODULE_KEYS = ['workflow', 'modelRuntime', 'templates', 'storage', 'diagnostics'] as const
const RELEASE_KEYS = ['local', 'workflow', 'templates'] as const
const CHANGELOG_KEYS = ['stageReview', 'serviceConfig', 'feedbackSync', 'updateCheck', 'exportQueue'] as const

function shortBootId(value: string) {
  return value.length > 12 ? `${value.slice(0, 12)}...` : value
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

export function FrameUpdatesDashboard() {
  const t = useTranslations('workspace.updatesPanel')
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [checkRecords, setCheckRecords] = useState<UpdateCheckRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadStatus() {
      setIsLoading(true)
      setError(null)
      try {
        const [statusResponse, checkResponse] = await Promise.all([
          apiFetch('/api/system/status'),
          apiFetch('/api/system/update-check'),
        ])
        if (!statusResponse.ok) {
          throw new Error(`${statusResponse.status} ${statusResponse.statusText}`.trim())
        }
        const data = (await statusResponse.json()) as SystemStatus
        const checkData = checkResponse.ok ? (await checkResponse.json()) as UpdateCheckResponse : null
        if (!cancelled) {
          setStatus(data)
          setCheckRecords(Array.isArray(checkData?.records) ? checkData.records : [])
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : t('loadFailed'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadStatus()
    return () => {
      cancelled = true
    }
  }, [t])

  const dependencyRows = useMemo(() => [
    { key: 'node', value: status?.node || '-' },
    { key: 'npm', value: status?.npm || '-' },
    { key: 'next', value: status?.next || '-' },
    { key: 'react', value: status?.react || '-' },
  ], [status])

  const moduleRows = useMemo(() => MODULE_KEYS.map((key, index) => ({
    key,
    health: index === 0 || index === 4 ? 'synced' : 'tracked',
    version: key === 'workflow' ? status?.version || '-' : t(`moduleMatrix.versions.${key}`),
    checkedAt: status?.checkedAt ? formatDate(status.checkedAt) : '-',
  })), [status, t])

  async function runUpdateCheck() {
    setIsChecking(true)
    setError(null)
    try {
      const response = await apiFetch('/api/system/update-check', { method: 'POST' })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
      const data = (await response.json()) as UpdateCheckResponse
      if (data.status) setStatus(data.status)
      setCheckRecords(Array.isArray(data.records) ? data.records : [])
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : t('checkFailed'))
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <section className="rounded-lg border border-white/10 bg-[#151820] p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <AppIcon name="arrowDownCircle" className="h-4 w-4 text-[#7eb0ff]" />
              {t('title')}
            </div>
            <p className="mt-1 text-xs leading-5 text-white/45">{t('subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runUpdateCheck}
              disabled={isChecking}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#2c6ef2] px-3 text-sm font-semibold text-white hover:bg-[#1f5edd] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
            >
              <AppIcon name={isChecking ? 'loader' : 'refresh'} className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
              {isChecking ? t('checkingNow') : t('runCheck')}
            </button>
            <Link
              href={{ pathname: '/toolbox' }}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white/72 hover:bg-white/8 hover:text-white"
            >
              <AppIcon name="clipboardCheck" className="h-4 w-4" />
              {t('openDiagnostics')}
            </Link>
          </div>
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
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                <div className="text-xs text-white/42">{t('cards.version')}</div>
                <div className="mt-1 text-xl font-bold text-white">{status?.version || '-'}</div>
              </div>
              <div className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                <div className="text-xs text-white/42">{t('cards.bootId')}</div>
                <div className="mt-1 font-mono text-sm font-semibold text-white">{shortBootId(status?.bootId || '-')}</div>
              </div>
              <div className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                <div className="text-xs text-white/42">{t('cards.status')}</div>
                <div className="mt-1 inline-flex rounded border border-[#45d483]/30 bg-[#45d483]/10 px-2 py-0.5 text-sm font-semibold text-[#8ff0b9]">
                  {t('status.current')}
                </div>
              </div>
              <div className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                <div className="text-xs text-white/42">{t('cards.checkedAt')}</div>
                <div className="mt-1 text-sm font-semibold text-white">{formatDate(status?.checkedAt || '')}</div>
              </div>
            </div>

            <div className="overflow-hidden rounded-md border border-white/10">
              <div className="grid grid-cols-[1fr_1.3fr] gap-3 border-b border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/45">
                <div>{t('table.item')}</div>
                <div>{t('table.value')}</div>
              </div>
              <div className="divide-y divide-white/8">
                {dependencyRows.map((row) => (
                  <div key={row.key} className="grid grid-cols-[1fr_1.3fr] gap-3 px-3 py-3 text-sm">
                    <div className="text-white/58">{t(`dependencies.${row.key}`)}</div>
                    <div className="font-mono text-white/76">{row.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-md border border-white/10">
              <div className="flex flex-col gap-1 border-b border-white/10 bg-white/5 px-3 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white/78">
                    <AppIcon name="clipboardCheck" className="h-4 w-4 text-[#9bc3ff]" />
                    {t('moduleMatrix.title')}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-white/40">{t('moduleMatrix.subtitle')}</p>
                </div>
                <span className="w-fit rounded border border-[#45d483]/30 bg-[#45d483]/10 px-2 py-1 text-[11px] font-medium text-[#8ff0b9]">
                  {t('moduleMatrix.localMode')}
                </span>
              </div>
              <div className="grid grid-cols-[.9fr_.65fr_.75fr_.9fr] gap-2 border-b border-white/10 bg-[#10131b] px-3 py-2 text-[11px] font-medium text-white/42">
                <div>{t('moduleMatrix.columns.module')}</div>
                <div>{t('moduleMatrix.columns.status')}</div>
                <div>{t('moduleMatrix.columns.version')}</div>
                <div>{t('moduleMatrix.columns.checkedAt')}</div>
              </div>
              <div className="divide-y divide-white/8">
                {moduleRows.map((row) => (
                  <div key={row.key} className="grid grid-cols-[.9fr_.65fr_.75fr_.9fr] gap-2 px-3 py-3 text-xs">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-white/74">{t(`moduleMatrix.modules.${row.key}.title`)}</div>
                      <div className="mt-0.5 truncate text-[11px] text-white/34">{t(`moduleMatrix.modules.${row.key}.hint`)}</div>
                    </div>
                    <div>
                      <span className={`rounded border px-1.5 py-0.5 text-[11px] ${
                        row.health === 'synced'
                          ? 'border-[#45d483]/30 bg-[#45d483]/10 text-[#8ff0b9]'
                          : 'border-[#7eb0ff]/30 bg-[#2c6ef2]/10 text-[#9bc3ff]'
                      }`}>
                        {t(`moduleMatrix.status.${row.health}`)}
                      </span>
                    </div>
                    <div className="truncate font-mono text-white/58">{row.version}</div>
                    <div className="truncate text-white/42">{row.checkedAt}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <aside className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-[#151820] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="refresh" className="h-4 w-4 text-[#7eb0ff]" />
            {t('historyTitle')}
          </div>
          {checkRecords.length === 0 ? (
            <div className="rounded-md border border-white/10 bg-white/4 px-3 py-6 text-sm text-white/45">
              {t('historyEmpty')}
            </div>
          ) : (
            <div className="space-y-2">
              {checkRecords.slice(0, 5).map((record) => (
                <div key={record.id} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-white/76">{record.version}</div>
                    <span className="rounded border border-[#45d483]/30 bg-[#45d483]/10 px-1.5 py-0.5 text-[11px] text-[#8ff0b9]">
                      {t('status.current')}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-white/34">{shortBootId(record.bootId)}</div>
                  <div className="mt-2 text-xs text-white/42">{formatDate(record.checkedAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-[#151820] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="badgeCheck" className="h-4 w-4 text-[#7eb0ff]" />
            {t('checklistTitle')}
          </div>
          <div className="space-y-2">
            {(['workflow', 'models', 'templates', 'storage'] as const).map((key) => (
              <div key={key} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-white/76">{t(`checklist.${key}.title`)}</div>
                  <span className="rounded border border-[#45d483]/30 bg-[#45d483]/10 px-1.5 py-0.5 text-[11px] text-[#8ff0b9]">
                    {t('status.tracked')}
                  </span>
                </div>
                <div className="mt-1 text-xs leading-5 text-white/38">{t(`checklist.${key}.hint`)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#151820] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="clock" className="h-4 w-4 text-[#7eb0ff]" />
            {t('releaseTitle')}
          </div>
          <div className="space-y-2">
            {RELEASE_KEYS.map((key) => (
              <div key={key} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-white/76">{t(`release.${key}.title`)}</div>
                  <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-white/42">
                    {t(`release.${key}.meta`)}
                  </span>
                </div>
                <div className="mt-1 text-xs leading-5 text-white/38">{t(`release.${key}.hint`)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#151820] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="bookmark" className="h-4 w-4 text-[#7eb0ff]" />
            {t('changelogTitle')}
          </div>
          <div className="space-y-2">
            {CHANGELOG_KEYS.map((key) => (
              <div key={key} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                <div className="text-sm font-medium text-white/76">{t(`changelog.${key}.title`)}</div>
                <div className="mt-1 text-xs leading-5 text-white/38">{t(`changelog.${key}.hint`)}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}
