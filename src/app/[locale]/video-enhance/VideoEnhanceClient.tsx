'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import Navbar from '@/components/Navbar'
import { AppIcon, IconGradientDefs } from '@/components/ui/icons'
import { useRouter } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'

import {
  STATUS_LABELS,
  downloadWithAnchor,
  formatBytes,
  formatDateTime,
  formatSeconds,
  isDownloadable,
  isTerminalStatus,
  makeUniqueDownloadName,
  resultDownloadUrl,
  resultFileName,
  statusTone,
  type VideoEnhanceHistoryResponse,
  type VideoEnhanceRecord,
} from '@/lib/video-enhance/history-view'

export default function VideoEnhanceClient() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [records, setRecords] = useState<VideoEnhanceRecord[]>([])
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null)
  const [selectedDownloadIds, setSelectedDownloadIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [batchDownloading, setBatchDownloading] = useState(false)
  const [batchProgress, setBatchProgress] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'loading') return
    if (!session) router.push({ pathname: '/auth/signin' })
  }, [session, status, router])

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch('/api/video-enhance?limit=100')
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '读取历史记录失败'))
      const payload = await response.json() as VideoEnhanceHistoryResponse
      const items = payload.tasks || []
      setRecords(items)
      setActiveRecordId((current) => current && items.some((record) => record.id === current) ? current : items[0]?.id || null)
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : '读取历史记录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status !== 'authenticated') return
    void loadHistory()
  }, [loadHistory, status])

  const activeRecord = useMemo(
    () => records.find((record) => record.id === activeRecordId) || records[0] || null,
    [activeRecordId, records],
  )
  const completedRecords = useMemo(() => records.filter(isDownloadable), [records])
  const selectedCompletedRecords = useMemo(
    () => completedRecords.filter((record) => selectedDownloadIds.has(record.id)),
    [completedRecords, selectedDownloadIds],
  )
  const batchDownloadTargets = selectedCompletedRecords.length > 0 ? selectedCompletedRecords : completedRecords
  const summary = useMemo(() => ({
    total: records.length,
    completed: records.filter((record) => record.status.toLowerCase() === 'completed').length,
    failed: records.filter((record) => record.status.toLowerCase() === 'failed').length,
    unfinished: records.filter((record) => !isTerminalStatus(record.status)).length,
  }), [records])

  useEffect(() => {
    const downloadableIds = new Set(completedRecords.map((record) => record.id))
    setSelectedDownloadIds((current) => {
      const next = new Set(Array.from(current).filter((id) => downloadableIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [completedRecords])

  const handleDownloadRecord = (record: VideoEnhanceRecord) => {
    const url = resultDownloadUrl(record)
    if (!url) {
      setError('该历史记录没有可下载的完成结果')
      return
    }
    setError(null)
    downloadWithAnchor(url, resultFileName(record))
  }

  const handleBatchDownload = async () => {
    const targets = batchDownloadTargets
    if (targets.length === 0 || batchDownloading) return
    setBatchDownloading(true)
    setError(null)
    setNotice(null)
    const usedNames = new Set<string>()
    let started = 0
    let skipped = 0
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const record = targets[index]
        setBatchProgress(`${index + 1}/${targets.length}`)
        const url = resultDownloadUrl(record)
        if (!url) {
          skipped += 1
          continue
        }
        downloadWithAnchor(url, makeUniqueDownloadName(resultFileName(record), usedNames))
        started += 1
        if (index < targets.length - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 350))
        }
      }
      setNotice(started > 0
        ? `已开始下载 ${started} 个结果${skipped > 0 ? `，${skipped} 个缺少下载地址` : ''}。如浏览器拦截多个下载，请允许本站点的多文件下载。`
        : '没有可下载的完成结果。')
    } finally {
      setBatchDownloading(false)
      setBatchProgress(null)
    }
  }

  const copyTaskId = async (taskId: string | null) => {
    if (!taskId) return
    await navigator.clipboard.writeText(taskId)
    setNotice('已复制任务 ID')
  }

  const toggleDownloadSelection = (recordId: string) => {
    setSelectedDownloadIds((current) => {
      const next = new Set(current)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }

  const toggleAllCompletedSelections = () => {
    setSelectedDownloadIds((current) => {
      if (completedRecords.length > 0 && completedRecords.every((record) => current.has(record.id))) {
        return new Set()
      }
      return new Set(completedRecords.map((record) => record.id))
    })
  }

  if (status === 'loading' || (status === 'unauthenticated' && !session)) {
    return (
      <div className="glass-page min-h-screen flex items-center justify-center">
        <AppIcon name="loader" className="h-6 w-6 animate-spin text-[var(--glass-tone-info-fg)]" />
      </div>
    )
  }

  return (
    <div className="glass-page min-h-screen font-sans selection:bg-[var(--glass-tone-info-bg)]">
      <IconGradientDefs />
      <Navbar />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-3 border-b border-[var(--glass-stroke-soft)] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--glass-text-secondary)]">
              <AppIcon name="film" className="h-3.5 w-3.5 text-[var(--glass-tone-info-fg)]" />
              AI MediaKit
            </div>
            <h1 className="text-2xl font-bold tracking-normal text-[var(--glass-text-primary)] sm:text-3xl">画质增强</h1>
            <p className="mt-2 text-sm text-[var(--glass-text-secondary)]">新任务已停用，本页仅保留历史记录和已完成结果下载。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--glass-text-secondary)]">
            <span className="rounded-full border border-[var(--glass-tone-warning-fg)]/25 bg-[var(--glass-tone-warning-bg)] px-3 py-1 font-semibold text-[var(--glass-tone-warning-fg)]">服务已停用</span>
            <button
              type="button"
              onClick={() => void loadHistory()}
              disabled={loading}
              className="glass-btn-base glass-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold disabled:opacity-60"
            >
              <AppIcon name="refresh" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              刷新历史
            </button>
          </div>
        </div>

        <div className="mb-5 rounded-lg border border-[var(--glass-tone-warning-fg)]/25 bg-[var(--glass-tone-warning-bg)] px-4 py-3 text-sm text-[var(--glass-tone-warning-fg)]">
          <div className="flex items-start gap-2">
            <AppIcon name="history" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <div className="font-semibold">MediaKit 视频增强新任务不可用</div>
              <p className="leading-6">
                旧版 MediaKit 专用服务已下线，平台不再接受新的画质增强任务，也不再查询未完成任务的进度。
                已完成结果的下载仍然可用，历史记录不会被删除；状态为排队中或处理中的历史任务不会继续更新。
              </p>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-[var(--glass-tone-danger-fg)]/25 bg-[var(--glass-tone-danger-bg)] px-4 py-3 text-sm text-[var(--glass-tone-danger-fg)]">{error}</div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-4 py-3 text-sm text-[var(--glass-text-secondary)]">{notice}</div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_440px]">
          <section className="glass-surface rounded-lg border border-[var(--glass-stroke-base)] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">历史记录</h2>
                <div className="mt-0.5 text-xs text-[var(--glass-text-tertiary)]">
                  {loading ? '正在读取历史记录...' : `共 ${records.length} 条记录`}
                </div>
              </div>
              {completedRecords.length > 0 ? (
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <label className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--glass-text-secondary)]">
                    <input
                      type="checkbox"
                      checked={completedRecords.every((record) => selectedDownloadIds.has(record.id))}
                      onChange={toggleAllCompletedSelections}
                      className="h-4 w-4 rounded border-[var(--glass-stroke-base)]"
                    />
                    全选完成
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleBatchDownload()}
                    disabled={batchDownloading || batchDownloadTargets.length === 0}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--glass-tone-info-fg)] disabled:opacity-60"
                  >
                    <AppIcon name={batchDownloading ? 'loader' : 'download'} className={`h-4 w-4 ${batchDownloading ? 'animate-spin' : ''}`} />
                    {batchDownloading ? `下载 ${batchProgress || ''}` : `批量下载 ${batchDownloadTargets.length}`}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mb-4 grid grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                <div className="text-[var(--glass-text-tertiary)]">总数</div>
                <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{summary.total}</div>
              </div>
              <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                <div className="text-[var(--glass-text-tertiary)]">未完成</div>
                <div className="mt-1 font-semibold text-[var(--glass-text-secondary)]">{summary.unfinished}</div>
              </div>
              <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                <div className="text-[var(--glass-text-tertiary)]">完成</div>
                <div className="mt-1 font-semibold text-[var(--glass-tone-success-fg)]">{summary.completed}</div>
              </div>
              <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                <div className="text-[var(--glass-text-tertiary)]">失败</div>
                <div className="mt-1 font-semibold text-[var(--glass-tone-danger-fg)]">{summary.failed}</div>
              </div>
            </div>

            {records.length > 0 ? (
              <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
                {records.map((record) => {
                  const downloadable = isDownloadable(record)
                  return (
                    <div
                      key={record.id}
                      className={`rounded-lg border p-3 transition-colors ${activeRecord?.id === record.id ? 'border-[var(--glass-tone-info-fg)]/45 bg-[var(--glass-tone-info-bg)]/30' : 'border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]'}`}
                    >
                      <div className="flex items-start gap-3">
                        {downloadable ? (
                          <input
                            type="checkbox"
                            checked={selectedDownloadIds.has(record.id)}
                            onChange={() => toggleDownloadSelection(record.id)}
                            className="mt-2 h-4 w-4 shrink-0 rounded border-[var(--glass-stroke-base)]"
                            aria-label={`选择 ${record.name}`}
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setActiveRecordId(record.id)}
                          className="mt-0.5 rounded-md p-1 text-[var(--glass-text-tertiary)] hover:bg-[var(--glass-bg-muted)] hover:text-[var(--glass-text-primary)]"
                          title="查看"
                        >
                          <AppIcon name={record.sourceType === 'url' ? 'link' : 'video'} className="h-4 w-4" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setActiveRecordId(record.id)}
                              className="min-w-0 truncate text-left text-sm font-semibold text-[var(--glass-text-primary)] hover:text-[var(--glass-tone-info-fg)]"
                            >
                              {record.name}
                            </button>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone(record.status)}`}>
                              {STATUS_LABELS[record.status.toLowerCase()] || record.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
                            {record.size ? formatBytes(record.size) : record.sourceUrl || record.fileSize || '-'}
                          </div>
                          <div className="mt-2 grid gap-1 text-[11px] text-[var(--glass-text-tertiary)] sm:grid-cols-2">
                            <span>上传：{formatDateTime(record.uploadedAt || record.createdAt)}</span>
                            <span>完成：{formatDateTime(record.finishedAt)}</span>
                          </div>
                          {record.taskId ? (
                            <button
                              type="button"
                              onClick={() => void copyTaskId(record.taskId)}
                              className="mt-2 inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-[var(--glass-text-secondary)] hover:text-[var(--glass-tone-info-fg)]"
                            >
                              <span className="truncate">{record.taskId}</span>
                              <AppIcon name="copy" className="h-3 w-3 shrink-0" />
                            </button>
                          ) : null}
                          {record.error ? <div className="mt-2 text-xs text-[var(--glass-tone-danger-fg)]">{record.error}</div> : null}
                        </div>
                        {downloadable ? (
                          <button
                            type="button"
                            onClick={() => handleDownloadRecord(record)}
                            className="rounded-md p-1 text-[var(--glass-text-tertiary)] hover:bg-[var(--glass-bg-muted)] hover:text-[var(--glass-tone-info-fg)]"
                            title="下载完成结果"
                          >
                            <AppIcon name="download" className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg bg-[var(--glass-bg-surface)] px-3 py-8 text-center text-sm text-[var(--glass-text-tertiary)]">
                {loading ? '正在加载历史记录...' : '暂无历史记录'}
              </div>
            )}
          </section>

          <aside className="space-y-5">
            <section className="glass-surface rounded-lg border border-[var(--glass-stroke-base)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">增强结果</h2>
                {activeRecord && isDownloadable(activeRecord) ? (
                  <button
                    type="button"
                    onClick={() => handleDownloadRecord(activeRecord)}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--glass-tone-info-fg)]"
                  >
                    <AppIcon name="download" className="h-4 w-4" />
                    下载结果
                  </button>
                ) : null}
              </div>
              {activeRecord?.result?.videoUrl ? (
                <div className="space-y-3">
                  <div className="aspect-video overflow-hidden rounded-lg border border-[var(--glass-stroke-soft)] bg-black/40">
                    <video src={activeRecord.result.videoUrl} controls className="h-full w-full object-contain" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                      <div className="text-[var(--glass-text-tertiary)]">时长</div>
                      <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{formatSeconds(activeRecord.result.duration)}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                      <div className="text-[var(--glass-text-tertiary)]">分辨率</div>
                      <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{activeRecord.result.resolution || '-'}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                      <div className="text-[var(--glass-text-tertiary)]">FPS</div>
                      <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{activeRecord.result.fps || '-'}</div>
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                      <div className="text-[var(--glass-text-tertiary)]">上传时间</div>
                      <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{formatDateTime(activeRecord.uploadedAt || activeRecord.createdAt)}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--glass-bg-surface)] px-2 py-2">
                      <div className="text-[var(--glass-text-tertiary)]">完成时间</div>
                      <div className="mt-1 font-semibold text-[var(--glass-text-primary)]">{formatDateTime(activeRecord.finishedAt)}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-[var(--glass-bg-surface)] px-3 py-8 text-center text-sm text-[var(--glass-text-tertiary)]">
                  {activeRecord ? `当前记录状态：${STATUS_LABELS[activeRecord.status.toLowerCase()] || activeRecord.status}，暂无可下载结果` : '选择一条历史记录后查看结果'}
                </div>
              )}
              {activeRecord ? (
                <div className="mt-3 space-y-1 border-t border-[var(--glass-stroke-soft)] pt-3 text-xs text-[var(--glass-text-tertiary)]">
                  <div className="truncate">记录：{activeRecord.name}</div>
                  {activeRecord.taskId ? (
                    <button
                      type="button"
                      onClick={() => void copyTaskId(activeRecord.taskId)}
                      className="inline-flex max-w-full items-center gap-1 font-mono hover:text-[var(--glass-tone-info-fg)]"
                    >
                      <span className="truncate">{activeRecord.taskId}</span>
                      <AppIcon name="copy" className="h-3 w-3 shrink-0" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          </aside>
        </div>
      </main>
    </div>
  )
}
