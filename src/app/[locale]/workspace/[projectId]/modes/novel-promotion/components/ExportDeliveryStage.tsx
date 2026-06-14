'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { useWorkspaceEpisodeStageData } from '../hooks/useWorkspaceEpisodeStageData'
import { useWorkspaceStageRuntime } from '../WorkspaceStageRuntimeContext'
import { useWorkspaceProvider } from '../WorkspaceProvider'

type DeliveryCard = {
  id: ExportQueueCardId
  title: string
  description: string
  icon: 'video' | 'package' | 'folderOpen' | 'audioWave'
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
    voices?: number
  }
}

type ExportHistoryResponse = {
  records?: ExportRecord[]
}

type ExportQueueCardId = 'final-video' | 'asset-package' | 'voice-package' | 'jianying-draft'
type ExportQueueBlockerCode = 'ready' | 'missingVideos' | 'noImages' | 'noVoices' | 'noPanels' | 'manifestOnly'

type ExportQueueServerItem = {
  id: string
  cardId: ExportQueueCardId
  status: 'ready' | 'blocked' | 'available'
  blockerCode: ExportQueueBlockerCode
  blockerParams?: {
    count?: number
  }
}

type ExportQueueItem = {
  id: string
  cardId: ExportQueueCardId
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
  items?: ExportQueueServerItem[]
  records?: ExportQueueRecord[]
}

export default function ExportDeliveryStage() {
  const t = useTranslations('video.exportDelivery')
  const runtime = useWorkspaceStageRuntime()
  const { projectId, episodeId } = useWorkspaceProvider()
  const { episodeName, clips, storyboards, voiceLines } = useWorkspaceEpisodeStageData()
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null)
  const [serverExportRecords, setServerExportRecords] = useState<ExportRecord[]>([])
  const [serverExportQueueItems, setServerExportQueueItems] = useState<ExportQueueServerItem[]>([])
  const [exportQueueRecords, setExportQueueRecords] = useState<ExportQueueRecord[]>([])
  const [queueLoadError, setQueueLoadError] = useState(false)
  const [queueingId, setQueueingId] = useState<string | null>(null)

  const panels = useMemo(
    () => storyboards.flatMap((storyboard) => storyboard.panels || []),
    [storyboards],
  )

  const generatedPanels = panels.filter((panel) => Boolean(panel.videoUrl || panel.lipSyncVideoUrl))
  const imagePanels = panels.filter((panel) => Boolean(panel.imageUrl))
  const generatedVoiceLines = voiceLines.filter((line) => Boolean(line.audioUrl))
  const missingVideoCount = Math.max(panels.length - generatedPanels.length, 0)
  const ready = generatedPanels.length > 0 && missingVideoCount === 0
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
      setServerExportQueueItems([])
      setExportQueueRecords([])
      setQueueLoadError(false)
      return
    }
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/export-queue?episodeId=${episodeId}`)
      if (signal?.aborted) return
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
      const payload = await response.json() as ExportQueueResponse
      if (!signal?.aborted) {
        setServerExportQueueItems(Array.isArray(payload.items) ? payload.items : [])
        setExportQueueRecords(Array.isArray(payload.records) ? payload.records : [])
        setQueueLoadError(false)
      }
    } catch {
      if (!signal?.aborted) {
        setServerExportQueueItems([])
        setExportQueueRecords([])
        setQueueLoadError(true)
      }
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

  const handleDownload = useCallback(async (cardId: string) => {
    if (!episodeId) {
      setDownloadMessage(t('actions.noEpisode'))
      return
    }

    setDownloadingId(cardId)
    setDownloadMessage(null)

    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/export-queue?episodeId=${episodeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { blocker?: string; message?: string; error?: string } | null
        throw new Error(payload?.blocker || payload?.message || payload?.error || t('queue.enqueueFailed'))
      }
      await Promise.all([loadExportQueue(), loadExportHistory()])
      setDownloadMessage(t('queue.enqueued'))
    } catch (error) {
      setDownloadMessage(error instanceof Error ? error.message : t('queue.enqueueFailed'))
    } finally {
      setDownloadingId(null)
    }
  }, [episodeId, loadExportHistory, loadExportQueue, projectId, t])

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
      id: 'voice-package',
      title: t('cards.voicePackage.title'),
      description: t('cards.voicePackage.description'),
      icon: 'audioWave',
      primary: t('cards.voicePackage.primary'),
      meta: t('cards.voicePackage.meta', { count: generatedVoiceLines.length }),
      disabled: generatedVoiceLines.length === 0,
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
    if (record.cardId === 'voice-package') return t('cards.voicePackage.title')
    if (record.cardId === 'jianying-draft') return t('cards.jianyingDraft.title')
    return record.title
  }

  const getQueueItemTitle = (cardId: ExportQueueCardId) => {
    if (cardId === 'final-video') return t('queue.items.finalVideo.title')
    if (cardId === 'asset-package') return t('queue.items.assetPackage.title')
    if (cardId === 'voice-package') return t('queue.items.voicePackage.title')
    return t('queue.items.editingDraft.title')
  }

  const getQueueItemDescription = (cardId: ExportQueueCardId) => {
    if (cardId === 'final-video') return t('queue.items.finalVideo.description')
    if (cardId === 'asset-package') return t('queue.items.assetPackage.description')
    if (cardId === 'voice-package') return t('queue.items.voicePackage.description')
    return t('queue.items.editingDraft.description')
  }

  const getQueueBlocker = (item: ExportQueueServerItem) => {
    if (item.blockerCode === 'ready') return t('queue.blockers.ready')
    if (item.blockerCode === 'missingVideos') {
      return t('queue.blockers.missingVideos', { count: item.blockerParams?.count ?? missingVideoCount })
    }
    if (item.blockerCode === 'noImages') return t('queue.blockers.noImages')
    if (item.blockerCode === 'noVoices') return t('queue.blockers.noVoices')
    if (item.blockerCode === 'noPanels') return t('queue.blockers.noPanels')
    return t('queue.blockers.manifestOnly')
  }

  const exportQueueItems: ExportQueueItem[] = serverExportQueueItems.map((item) => ({
    id: item.id,
    cardId: item.cardId,
    title: getQueueItemTitle(item.cardId),
    description: getQueueItemDescription(item.cardId),
    status: item.status,
    blocker: getQueueBlocker(item),
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
        {exportQueueItems.length > 0 ? (
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
        ) : (
          <div className="flex min-h-28 flex-col items-center justify-center rounded-md border border-dashed border-white/10 bg-[#0f1014] text-center">
            <AppIcon name={queueLoadError ? 'alertOutline' : 'clock'} className="mb-3 h-5 w-5 text-white/28" />
            <div className="text-sm font-medium text-white/62">
              {queueLoadError ? t('queue.unavailableTitle') : t('queue.emptyTitle')}
            </div>
            <div className="mt-1 max-w-md text-xs leading-5 text-white/36">
              {queueLoadError ? t('queue.unavailableDescription') : t('queue.emptyDescription')}
            </div>
          </div>
        )}
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
