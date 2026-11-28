'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { statTileStyle } from '@/components/workspace/stat-tile-hue'
import {
  FeedbackImageUploader,
  collectFeedbackBrowserContext,
  useFeedbackAttachments,
  type FeedbackUploadedAttachment,
} from '@/components/workspace/FeedbackImageUploader'
import { APP_VERSION } from '@/lib/app-meta'
import { apiFetch } from '@/lib/api-fetch'

type FeedbackType = 'bug' | 'quality' | 'workflow' | 'idea'
type FeedbackStatus = 'open' | 'triaged' | 'resolved'

interface FeedbackRecord {
  id: string
  type: FeedbackType
  title: string
  description: string
  route: string
  userAgent: string
  attachments?: FeedbackUploadedAttachment[]
  resolutionNote?: string
  createdAt: string
  updatedAt?: string
  status: FeedbackStatus
}

interface FeedbackResponse {
  success?: boolean
  records?: FeedbackRecord[]
}

const FEEDBACK_TYPES: FeedbackType[] = ['bug', 'quality', 'workflow', 'idea']

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

export function FrameFeedbackDashboard() {
  const t = useTranslations('workspace.feedbackPanel')
  const [records, setRecords] = useState<FeedbackRecord[]>([])
  const [type, setType] = useState<FeedbackType>('bug')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [route, setRoute] = useState('')
  const [saved, setSaved] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const uploader = useFeedbackAttachments()

  useEffect(() => {
    setRoute(window.location.pathname + window.location.search)
    let cancelled = false

    async function loadFeedback() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/api/feedback')
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
        const data = (await response.json()) as FeedbackResponse
        if (!cancelled) {
          const nextRecords = Array.isArray(data.records) ? data.records : []
          setRecords(nextRecords)
        }
      } catch (loadError) {
        if (!cancelled) {
          setRecords([])
          setError(loadError instanceof Error ? loadError.message : t('loadFailed'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadFeedback()
    return () => {
      cancelled = true
    }
  }, [t])

  const stats = useMemo(() => ({
    total: records.length,
    bugs: records.filter((record) => record.type === 'bug').length,
    quality: records.filter((record) => record.type === 'quality').length,
    workflow: records.filter((record) => record.type === 'workflow').length,
    ideas: records.filter((record) => record.type === 'idea').length,
  }), [records])

  const triageRows = useMemo(() => FEEDBACK_TYPES.map((item) => {
    const typedRecords = records.filter((record) => record.type === item)
    const latest = typedRecords[0]
    return {
      type: item,
      count: typedRecords.length,
      open: typedRecords.filter((record) => record.status !== 'resolved').length,
      latestRoute: latest?.route || '-',
      latestAt: latest ? formatDate(latest.createdAt) : t('notStarted'),
    }
  }), [records, t])

  async function updateRecordStatus(id: string, status: FeedbackStatus) {
    const previousRecords = records
    const nextRecords = records.map((record) => record.id === id ? { ...record, status } : record)
    setRecords(nextRecords)

    try {
      const response = await apiFetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
      const data = (await response.json()) as FeedbackResponse
      const serverRecords = Array.isArray(data.records) ? data.records : nextRecords
      setRecords(serverRecords)
      setError(null)
    } catch (updateError) {
      setRecords(previousRecords)
      setError(updateError instanceof Error ? updateError.message : t('saveFailed'))
    }
  }

  async function saveFeedback(form: HTMLFormElement) {
    if (uploader.isUploading) return
    if (uploader.hasFailedUploads) {
      setError('有截图尚未上传成功，请点击重试或移除后再提交')
      return
    }
    const formData = new FormData(form)
    const trimmedTitle = String(formData.get('title') ?? title).trim()
    const trimmedDescription = String(formData.get('description') ?? description).trim()
    const submittedRoute = String(formData.get('route') ?? route).trim()
    const hasImages = uploader.uploadedAttachments.length > 0
    if (!trimmedDescription && !hasImages) return
    const finalDescription = trimmedDescription || '（附图反馈）'
    const finalTitle = trimmedTitle || (trimmedDescription ? trimmedDescription.split('\n')[0].slice(0, 40) : `截图反馈（${uploader.uploadedAttachments.length} 张）`)

    const nextRecord = {
      type,
      title: finalTitle,
      description: finalDescription,
      route: submittedRoute || window.location.pathname,
      userAgent: window.navigator.userAgent,
      attachments: uploader.uploadedAttachments.map(({ key, mimeType, name, size, width, height }) => ({
        key,
        mimeType,
        name,
        size,
        width,
        height,
      })),
      context: collectFeedbackBrowserContext(APP_VERSION),
    }

    try {
      const response = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextRecord),
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
      const data = (await response.json()) as FeedbackResponse
      setRecords(Array.isArray(data.records) ? data.records : records)
      setTitle('')
      setDescription('')
      uploader.clearAll()
      setSaved(true)
      setError(null)
      window.setTimeout(() => setSaved(false), 1800)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('saveFailed'))
      setSaved(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    saveFeedback(event.currentTarget)
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <section className="rounded-lg border border-white/10 bg-[rgb(var(--nori-s-16161d))] p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <AppIcon name="infoCircle" className="h-4 w-4 text-[var(--fos-primary-text)]" />
              {t('title')}
            </div>
            <p className="mt-1 text-xs leading-5 text-white/45">{t('subtitle')}</p>
          </div>
          <Link
            href={{ pathname: '/service-records' }}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white/72 hover:bg-white/8 hover:text-white"
          >
            <AppIcon name="receipt" className="h-4 w-4" />
            {t('openRecords')}
          </Link>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 text-center md:grid-cols-5">
          {(['total', 'bugs', 'quality', 'workflow', 'ideas'] as const).map((key) => (
            <div key={key} style={statTileStyle(key)} className="fos-stat-tile px-3 py-2">
              <div className="text-base font-bold text-[var(--hue)]">{stats[key]}</div>
              <div className="mt-0.5 text-[11px] text-white/42">{t(`stats.${key}`)}</div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} onPaste={uploader.handleReactPaste} className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-medium text-white/52">{t('fields.type')}</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {FEEDBACK_TYPES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setType(item)}
                  className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                    type === item
                      ? 'border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] text-[var(--fos-primary-text)]'
                      : 'border-white/10 bg-white/4 text-white/58 hover:bg-white/7 hover:text-white'
                  }`}
                >
                  {t(`types.${item}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div>
              <label className="mb-2 block text-xs font-medium text-white/52">{t('fields.title')}</label>
              <input
                name="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onInput={(event) => setTitle(event.currentTarget.value)}
                maxLength={80}
                className="h-10 w-full rounded-md border border-white/10 bg-[rgb(var(--nori-bg-1))] px-3 text-sm text-white outline-none transition-colors placeholder:text-white/24 focus:border-white/35"
                placeholder={t('placeholders.title')}
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-white/52">{t('fields.route')}</label>
              <input
                name="route"
                value={route}
                onChange={(event) => setRoute(event.target.value)}
                onInput={(event) => setRoute(event.currentTarget.value)}
                className="h-10 w-full rounded-md border border-white/10 bg-[rgb(var(--nori-bg-1))] px-3 text-sm text-white outline-none transition-colors placeholder:text-white/24 focus:border-white/35"
                placeholder="/zh/workspace"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-white/52">{t('fields.description')}</label>
            <textarea
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onInput={(event) => setDescription(event.currentTarget.value)}
              rows={5}
              maxLength={2000}
              className="w-full resize-none rounded-md border border-white/10 bg-[rgb(var(--nori-bg-1))] px-3 py-2 text-sm leading-6 text-white outline-none transition-colors placeholder:text-white/24 focus:border-white/35"
              placeholder={t('placeholders.description')}
            />
          </div>

          <FeedbackImageUploader
            items={uploader.items}
            limitNotice={uploader.limitNotice}
            maxImages={uploader.maxImages}
            onAddFiles={uploader.addFiles}
            onRetry={uploader.retryItem}
            onRemove={uploader.removeItem}
          />

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-white/34">
              {uploader.isUploading ? '正在上传截图…' : t('serverBacked')}
            </div>
            <button
              type="button"
              disabled={uploader.isUploading}
              onClick={(event) => {
                if (event.currentTarget.form) saveFeedback(event.currentTarget.form)
              }}
              data-ready={(description.trim() || uploader.uploadedAttachments.length > 0) && !uploader.isUploading ? 'true' : 'false'}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--fos-brand-solid)] px-4 text-sm font-semibold text-on-brand transition-colors hover:brightness-110 data-[ready=false]:bg-white/10 data-[ready=false]:text-white/32"
            >
              <AppIcon name={saved ? 'check' : 'plus'} className="h-4 w-4" />
              {saved ? t('saved') : t('submit')}
            </button>
          </div>
          {error ? (
            <div className="rounded-md border border-[rgb(var(--nori-s-ffd98a))]/20 bg-[rgb(var(--nori-s-ffd98a))]/8 px-3 py-2 text-xs text-[rgb(var(--nori-t-ffd98a))]">
              {t('syncWarning', { error })}
            </div>
          ) : null}
        </form>

        <div className="mt-5 overflow-hidden rounded-md border border-white/10">
          <div className="flex flex-col gap-1 border-b border-white/10 bg-white/5 px-3 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white/78">
                <AppIcon name="clipboardCheck" className="h-4 w-4 text-[var(--fos-primary-text)]" />
                {t('triageTitle')}
              </div>
              <p className="mt-1 text-xs leading-5 text-white/40">{t('triageSubtitle')}</p>
            </div>
            <span className="w-fit rounded border border-white/10 bg-[rgb(var(--nori-bg-2))] px-2 py-1 text-[11px] font-medium text-white/42">
              {t('serverTriage')}
            </span>
          </div>
          <div className="grid grid-cols-[.75fr_.5fr_.5fr_1fr_.75fr] gap-2 border-b border-white/10 bg-[rgb(var(--nori-bg-2))] px-3 py-2 text-[11px] font-medium text-white/42">
            <div>{t('triage.columns.type')}</div>
            <div>{t('triage.columns.total')}</div>
            <div>{t('triage.columns.open')}</div>
            <div>{t('triage.columns.route')}</div>
            <div>{t('triage.columns.latest')}</div>
          </div>
          <div className="divide-y divide-white/8">
            {isLoading ? (
              <div className="px-3 py-6 text-sm text-white/45">{t('loading')}</div>
            ) : triageRows.map((row) => (
              <div key={row.type} className="grid grid-cols-[.75fr_.5fr_.5fr_1fr_.75fr] gap-2 px-3 py-3 text-xs">
                <div className="truncate font-medium text-white/72">{t(`types.${row.type}`)}</div>
                <div className="text-white/56">{row.count}</div>
                <div className={row.open > 0 ? 'font-medium text-[rgb(var(--nori-t-ffd98a))]' : 'text-white/42'}>{row.open}</div>
                <div className="truncate font-mono text-white/42">{row.latestRoute}</div>
                <div className="truncate text-white/42">{row.latestAt}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-[rgb(var(--nori-s-16161d))] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="infoCircle" className="h-4 w-4 text-[var(--fos-primary-text)]" />
            {t('contextTitle')}
          </div>
          <div className="space-y-2">
            {(['route', 'browser', 'storage'] as const).map((key) => (
              <div key={key} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                <div className="text-xs text-white/38">{t(`context.${key}.label`)}</div>
                <div className="mt-1 truncate text-sm font-medium text-white/72">
                  {key === 'route' ? route || '-' : key === 'storage' ? t(`context.${key}.server`) : t(`context.${key}.value`)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[rgb(var(--nori-s-16161d))] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <AppIcon name="clock" className="h-4 w-4 text-[var(--fos-primary-text)]" />
            {t('recentTitle')}
          </div>
          {records.length === 0 ? (
            <div className="rounded-md border border-white/10 bg-white/4 px-3 py-6 text-sm text-white/45">
              {isLoading ? t('loading') : t('empty')}
            </div>
          ) : (
            <div className="space-y-2">
              {records.slice(0, 8).map((record) => (
                <article key={record.id} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="truncate text-sm font-medium text-white/78">{record.title}</div>
                    <span className="shrink-0 rounded border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] px-1.5 py-0.5 text-[11px] text-[var(--fos-primary-text)]">
                      {t(`types.${record.type}`)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs leading-5 text-white/45">{record.description}</p>
                  {record.attachments && record.attachments.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {record.attachments.map((att) => (
                        <a
                          key={att.key}
                          href={att.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block h-11 w-16 overflow-hidden rounded border border-white/12 bg-black/30 hover:border-white/35"
                          title={att.name || '查看截图'}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={att.url} alt={att.name || '反馈截图'} className="h-full w-full object-cover" loading="lazy" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {record.resolutionNote ? (
                    <div className="mt-2 rounded border border-[rgb(var(--nori-s-45d483))]/25 bg-[rgb(var(--nori-s-45d483))]/8 px-2 py-1.5 text-[11px] leading-4 text-[rgb(var(--nori-t-8ff0b9))]">
                      处理说明：{record.resolutionNote}
                    </div>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-white/30">
                    <span className="truncate font-mono">{record.route}</span>
                    <span className="shrink-0">{formatDate(record.createdAt)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] ${
                      record.status === 'resolved'
                        ? 'border-[rgb(var(--nori-s-45d483))]/30 bg-[rgb(var(--nori-s-45d483))]/10 text-[rgb(var(--nori-t-8ff0b9))]'
                        : record.status === 'triaged'
                          ? 'border-[rgb(var(--nori-s-ffd98a))]/30 bg-[rgb(var(--nori-s-ffd98a))]/10 text-[rgb(var(--nori-t-ffd98a))]'
                          : 'border-white/10 bg-white/5 text-white/42'
                    }`}>
                      {t(`status.${record.status}`)}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => updateRecordStatus(record.id, 'triaged')}
                        disabled={record.status === 'triaged'}
                        className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/52 hover:bg-white/8 disabled:cursor-not-allowed disabled:text-white/24"
                      >
                        {t('actions.triage')}
                      </button>
                      <button
                        type="button"
                        onClick={() => updateRecordStatus(record.id, 'resolved')}
                        disabled={record.status === 'resolved'}
                        className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/52 hover:bg-white/8 disabled:cursor-not-allowed disabled:text-white/24"
                      >
                        {t('actions.resolve')}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
