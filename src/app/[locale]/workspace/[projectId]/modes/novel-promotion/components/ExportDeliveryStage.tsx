'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { useWorkspaceEpisodeStageData } from '../hooks/useWorkspaceEpisodeStageData'
import { useWorkspaceStageRuntime } from '../WorkspaceStageRuntimeContext'
import { useWorkspaceProvider } from '../WorkspaceProvider'

type DeliveryCard = {
  id: string
  title: string
  description: string
  icon: 'video' | 'package' | 'folderOpen'
  primary: string
  meta: string
  disabled?: boolean
}

type ExportRecord = {
  id: string
  cardId: string
  title: string
  fileName: string
  createdAt: string
  status: 'completed'
  source?: 'persistent' | 'server'
  stats?: {
    clips: number
    panels: number
    images: number
    videos: number
  }
}

type ExportHistoryResponse = {
  records?: ExportRecord[]
}

type ExportQueueItem = {
  id: string
  cardId: string
  title: string
  description: string
  status: 'ready' | 'blocked' | 'available'
  blocker: string
  queuedStatus?: 'queued' | 'ready' | 'blocked'
}

type ExportQueueRecord = {
  id: string
  cardId: string
  title: string
  status: 'queued' | 'ready' | 'blocked'
  blocker?: string | null
  createdAt: string
  updatedAt: string
}

type ExportQueueResponse = {
  records?: ExportQueueRecord[]
}

export default function ExportDeliveryStage() {
  const t = useTranslations('video.exportDelivery')
  const runtime = useWorkspaceStageRuntime()
  const { projectId, episodeId } = useWorkspaceProvider()
  const { episodeName, clips, storyboards } = useWorkspaceEpisodeStageData()
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null)
  const [serverExportRecords, setServerExportRecords] = useState<ExportRecord[]>([])
  const [exportQueueRecords, setExportQueueRecords] = useState<ExportQueueRecord[]>([])
  const [queueingId, setQueueingId] = useState<string | null>(null)

  const panels = useMemo(
    () => storyboards.flatMap((storyboard) => storyboard.panels || []),
    [storyboards],
  )

  const generatedPanels = panels.filter((panel) => Boolean(panel.videoUrl || panel.lipSyncVideoUrl))
  const imagePanels = panels.filter((panel) => Boolean(panel.imageUrl))
  const missingVideoCount = Math.max(panels.length - generatedPanels.length, 0)
  const ready = generatedPanels.length > 0 && missingVideoCount === 0
  const scopeName = episodeName || t('episodeFallback')
  const loadExportHistory = useCallback(async (signal?: AbortSignal) => {
    if (!episodeId) {
      setServerExportRecords([])
      return
    }
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/export-history?episodeId=${episodeId}`)
      if (signal?.aborted) return
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
      const payload = await response.json() as ExportHistoryResponse
      if (!signal?.aborted) setServerExportRecords(Array.isArray(payload.records) ? payload.records : [])
    } catch {
      if (!signal?.aborted) setServerExportRecords([])
    }
  }, [episodeId, projectId])

  useEffect(() => {
    const controller = new AbortController()

    void loadExportHistory(controller.signal)
    return () => {
      controller.abort()
    }
  }, [loadExportHistory])

  const loadExportQueue = useCallback(async (signal?: AbortSignal) => {
    if (!episodeId) {
      setExportQueueRecords([])
      return
    }
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/export-queue?episodeId=${episodeId}`)
      if (signal?.aborted) return
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
      const payload = await response.json() as ExportQueueResponse
      if (!signal?.aborted) setExportQueueRecords(Array.isArray(payload.records) ? payload.records : [])
    } catch {
      if (!signal?.aborted) setExportQueueRecords([])
    }
  }, [episodeId, projectId])

  useEffect(() => {
    const controller = new AbortController()
    void loadExportQueue(controller.signal)
    return () => {
      controller.abort()
    }
  }, [loadExportQueue])

  const exportRecords = useMemo(() => {
    return serverExportRecords
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 12)
  }, [serverExportRecords])

  const appendExportRecord = useCallback(async (record: ExportRecord) => {
    if (!episodeId) return
    const response = await apiFetch(`/api/novel-promotion/${projectId}/export-history?episodeId=${episodeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    })
    if (!response.ok) throw new Error(t('actions.recordFailed'))
    await loadExportHistory()
  }, [episodeId, loadExportHistory, projectId, t])

  const saveResponseAsFile = useCallback(async (response: Response, fallbackFileName: string) => {
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null) as { message?: string; error?: string } | null
      throw new Error(errorPayload?.message || errorPayload?.error || t('actions.downloadFailed'))
    }

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fallbackFileName
    document.body.appendChild(anchor)
    anchor.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(anchor)
    return fallbackFileName
  }, [t])

  const handleDownload = useCallback(async (cardId: string) => {
    if (!episodeId) {
      setDownloadMessage(t('actions.noEpisode'))
      return
    }

    setDownloadingId(cardId)
    setDownloadMessage(null)

    try {
      if (cardId === 'final-video') {
        const response = await apiFetch(`/api/novel-promotion/${projectId}/download-videos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeId }),
        })
        const fileName = await saveResponseAsFile(response, `${scopeName}_videos.zip`)
        await appendExportRecord({
          id: `${Date.now()}-${cardId}`,
          cardId,
          title: t('cards.finalVideo.title'),
          fileName,
          createdAt: new Date().toISOString(),
          status: 'completed',
          stats: { clips: clips.length, panels: panels.length, images: imagePanels.length, videos: generatedPanels.length },
        })
      } else if (cardId === 'asset-package') {
        const response = await apiFetch(`/api/novel-promotion/${projectId}/download-images?episodeId=${episodeId}`)
        const fileName = await saveResponseAsFile(response, `${scopeName}_images.zip`)
        await appendExportRecord({
          id: `${Date.now()}-${cardId}`,
          cardId,
          title: t('cards.assetPackage.title'),
          fileName,
          createdAt: new Date().toISOString(),
          status: 'completed',
          stats: { clips: clips.length, panels: panels.length, images: imagePanels.length, videos: generatedPanels.length },
        })
      } else {
        const response = await apiFetch(`/api/novel-promotion/${projectId}/export-manifest?episodeId=${episodeId}`)
        const fileName = await saveResponseAsFile(response, `${scopeName}_manifest.json`)
        await appendExportRecord({
          id: `${Date.now()}-${cardId}`,
          cardId,
          title: t('cards.jianyingDraft.title'),
          fileName,
          createdAt: new Date().toISOString(),
          status: 'completed',
          stats: { clips: clips.length, panels: panels.length, images: imagePanels.length, videos: generatedPanels.length },
        })
      }
      setDownloadMessage(t('actions.downloadReady'))
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : t('actions.downloadFailed'))
    } finally {
      setDownloadingId(null)
    }
  }, [appendExportRecord, clips.length, episodeId, generatedPanels.length, imagePanels.length, panels.length, projectId, saveResponseAsFile, scopeName, t])

  const cards: DeliveryCard[] = [
    {
      id: 'final-video',
      title: t('cards.finalVideo.title'),
      description: t('cards.finalVideo.description'),
      icon: 'video',
      primary: t('cards.finalVideo.primary'),
      meta: t('cards.finalVideo.meta', { count: generatedPanels.length }),
      disabled: generatedPanels.length === 0,
    },
    {
      id: 'asset-package',
      title: t('cards.assetPackage.title'),
      description: t('cards.assetPackage.description'),
      icon: 'package',
      primary: t('cards.assetPackage.primary'),
      meta: t('cards.assetPackage.meta', { count: imagePanels.length }),
      disabled: imagePanels.length === 0,
    },
    {
      id: 'jianying-draft',
      title: t('cards.jianyingDraft.title'),
      description: t('cards.jianyingDraft.description'),
      icon: 'folderOpen',
      primary: t('cards.jianyingDraft.primary'),
      meta: t('cards.jianyingDraft.meta', { count: clips.length }),
      disabled: panels.length === 0,
    },
  ]

  const getRecordTitle = (record: ExportRecord) => {
    if (record.cardId === 'final-video') return t('cards.finalVideo.title')
    if (record.cardId === 'asset-package') return t('cards.assetPackage.title')
    if (record.cardId === 'jianying-draft') return t('cards.jianyingDraft.title')
    return record.title
  }

  const baseExportQueueItems: ExportQueueItem[] = [
    {
      id: 'queue-final-video',
      cardId: 'final-video',
      title: t('queue.items.finalVideo.title'),
      description: t('queue.items.finalVideo.description'),
      status: ready ? 'ready' : 'blocked',
      blocker: missingVideoCount > 0 ? t('queue.blockers.missingVideos', { count: missingVideoCount }) : t('queue.blockers.ready'),
    },
    {
      id: 'queue-asset-package',
      cardId: 'asset-package',
      title: t('queue.items.assetPackage.title'),
      description: t('queue.items.assetPackage.description'),
      status: imagePanels.length > 0 ? 'ready' : 'blocked',
      blocker: imagePanels.length > 0 ? t('queue.blockers.ready') : t('queue.blockers.noImages'),
    },
    {
      id: 'queue-editing-draft',
      cardId: 'jianying-draft',
      title: t('queue.items.editingDraft.title'),
      description: t('queue.items.editingDraft.description'),
      status: panels.length > 0 ? 'available' : 'blocked',
      blocker: panels.length > 0 ? t('queue.blockers.manifestOnly') : t('queue.blockers.noPanels'),
    },
  ]

  const exportQueueItems: ExportQueueItem[] = baseExportQueueItems.map((item) => ({
    ...item,
    queuedStatus: exportQueueRecords.find((record) => record.cardId === item.cardId)?.status,
  }))

  const enqueueExportItem = useCallback(async (item: ExportQueueItem) => {
    if (!episodeId || item.status === 'blocked') return
    setQueueingId(item.id)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/export-queue?episodeId=${episodeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId: item.cardId,
          title: item.title,
          status: 'queued',
          blocker: item.blocker,
        }),
      })
      if (!response.ok) throw new Error(t('queue.enqueueFailed'))
      await loadExportQueue()
      setDownloadMessage(t('queue.enqueued'))
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : t('queue.enqueueFailed'))
    } finally {
      setQueueingId(null)
    }
  }, [episodeId, loadExportQueue, projectId, t])

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pb-12">
      <div className="rounded-lg border border-white/10 bg-[#15161b] p-5 shadow-[0_18px_50px_rgba(0,0,0,.20)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/58">
              <AppIcon name="download" className="h-3.5 w-3.5" />
              {t('eyebrow')}
            </div>
            <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
              {t('subtitle', { episode: episodeName || t('episodeFallback') })}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-white/10 bg-[#0f1014] p-2 text-center">
            <div className="px-3 py-2">
              <div className="text-lg font-semibold text-white">{clips.length}</div>
              <div className="text-[11px] text-white/42">{t('stats.scenes')}</div>
            </div>
            <div className="border-x border-white/10 px-3 py-2">
              <div className="text-lg font-semibold text-white">{panels.length}</div>
              <div className="text-[11px] text-white/42">{t('stats.shots')}</div>
            </div>
            <div className="px-3 py-2">
              <div className="text-lg font-semibold text-white">{generatedPanels.length}</div>
              <div className="text-[11px] text-white/42">{t('stats.videos')}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <article
              key={card.id}
              className="flex min-h-[260px] flex-col rounded-lg border border-white/10 bg-[#171922] p-5 shadow-[0_14px_34px_rgba(0,0,0,.16)]"
            >
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-md bg-[#2c6ef2] text-white">
                <AppIcon name={card.icon} className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-white">{card.title}</h2>
              <p className="mt-2 min-h-12 text-sm leading-6 text-white/52">{card.description}</p>
              <div className="mt-auto">
                <div className="mb-3 text-xs text-white/38">{card.meta}</div>
                <button
                  type="button"
                  onClick={() => void handleDownload(card.id)}
                  disabled={card.disabled || downloadingId !== null}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/7 px-3 text-sm font-semibold text-white transition-colors hover:bg-white/12 disabled:cursor-not-allowed disabled:text-white/30"
                >
                  <AppIcon name={card.disabled ? 'alertOutline' : 'download'} className="h-4 w-4" />
                  {downloadingId === card.id ? t('actions.downloading') : card.primary}
                </button>
              </div>
            </article>
          ))}
        </div>

        <aside className="rounded-lg border border-white/10 bg-[#15161b] p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-400' : 'bg-[#d6ff00]'}`} />
            <h2 className="text-sm font-semibold text-white">{t('readiness.title')}</h2>
          </div>
          <div className="space-y-3">
            <div className="rounded-md border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/58">{t('readiness.videoCoverage')}</span>
                <span className="font-semibold text-white">
                  {generatedPanels.length}/{panels.length}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#2c6ef2]"
                  style={{ width: `${panels.length ? Math.round((generatedPanels.length / panels.length) * 100) : 0}%` }}
                />
              </div>
            </div>
            {missingVideoCount > 0 ? (
              <div className="rounded-md border border-[#f5a524]/25 bg-[#f5a524]/10 p-3 text-sm leading-6 text-[#ffd58a]">
                {t('readiness.missingVideos', { count: missingVideoCount })}
              </div>
            ) : (
              <div className="rounded-md border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm leading-6 text-emerald-200">
                {t('readiness.ready')}
              </div>
            )}
            <button
              type="button"
              onClick={() => runtime.onStageChange('videos')}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#2c6ef2] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#1f5edd]"
            >
              <AppIcon name="film" className="h-4 w-4" />
              {t('readiness.backToShots')}
            </button>
            {downloadMessage ? (
              <div className="rounded-md border border-white/10 bg-white/5 p-3 text-xs leading-5 text-white/55">
                {downloadMessage}
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      <div className="rounded-lg border border-white/10 bg-[#15161b] p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">{t('queue.title')}</h2>
            <div className="mt-1 text-xs text-white/38">{t('queue.description')}</div>
          </div>
          <span className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/46">
            {t('queue.count', { count: exportQueueItems.length })}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {exportQueueItems.map((item) => (
            <div key={item.id} className="rounded-md border border-white/10 bg-[#0f1014] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">{item.title}</div>
                <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                  item.status === 'ready'
                    ? 'bg-emerald-400/10 text-emerald-200'
                    : item.status === 'available'
                      ? 'bg-[#2c6ef2]/14 text-[#9bc3ff]'
                      : 'bg-[#f5a524]/10 text-[#ffd58a]'
                }`}>
                  {t(`queue.status.${item.status}`)}
                </span>
              </div>
              <p className="min-h-10 text-xs leading-5 text-white/44">{item.description}</p>
              <div className="mt-3 rounded border border-white/8 bg-white/4 px-3 py-2 text-xs leading-5 text-white/46">
                {item.blocker}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[11px] text-white/34">
                  {item.queuedStatus ? t(`queue.backendStatus.${item.queuedStatus}`) : t('queue.backendStatus.idle')}
                </span>
                <button
                  type="button"
                  onClick={() => void enqueueExportItem(item)}
                  disabled={item.status === 'blocked' || queueingId !== null}
                  className="inline-flex h-7 items-center justify-center rounded border border-white/10 bg-white/6 px-2 text-[11px] font-medium text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {queueingId === item.id ? t('queue.enqueueing') : t('queue.enqueue')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-[#15161b] p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-white">{t('history.title')}</h2>
          <span className="text-xs text-white/38">
            {exportRecords.length > 0 ? t('history.countBadge', { count: exportRecords.length }) : t('history.emptyBadge')}
          </span>
        </div>
        {exportRecords.length > 0 ? (
          <div className="divide-y divide-white/10 overflow-hidden rounded-md border border-white/10 bg-[#0f1014]">
            {exportRecords.map((record) => (
              <div key={record.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_150px_92px] sm:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <AppIcon name={record.cardId === 'final-video' ? 'video' : record.cardId === 'asset-package' ? 'package' : 'folderOpen'} className="h-4 w-4 text-[#d6ff00]" />
                    <div className="truncate text-sm font-semibold text-white">{getRecordTitle(record)}</div>
                  </div>
                  <div className="mt-1 truncate text-xs text-white/38">{record.fileName}</div>
                  {record.stats ? (
                    <div className="mt-1 text-[11px] text-white/30">
                      {t('history.stats', {
                        clips: record.stats.clips,
                        panels: record.stats.panels,
                        videos: record.stats.videos,
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="text-xs text-white/42">
                  {new Intl.DateTimeFormat(undefined, {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(record.createdAt))}
                </div>
                <div className="inline-flex h-7 items-center justify-center rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 text-xs font-medium text-emerald-200">
                  {record.source === 'server' ? t('history.available') : t('history.completed')}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center rounded-md border border-dashed border-white/10 bg-[#0f1014] text-center">
            <AppIcon name="clock" className="mb-3 h-5 w-5 text-white/28" />
            <div className="text-sm font-medium text-white/62">{t('history.emptyTitle')}</div>
            <div className="mt-1 text-xs text-white/36">{t('history.emptyDescription')}</div>
          </div>
        )}
      </div>
    </section>
  )
}
