'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { confirmAction } from '@/lib/ui/feedback'
import { toPlayableVideoUrl, toVideoPosterUrl } from '@/lib/media/image-url'
import type {
  AssetsArtifact,
  BatchItemDTO,
  BatchStageState,
  StoryboardArtifact,
  VideoGenArtifact,
  VideoGenShotEntry,
  VideoShotTake,
  WorkflowAssetItem,
} from '@/lib/batch-workflow/types'
import {
  clampDurationSec,
  durationOptions,
  findNavigableShotIndex,
  findNextPlayableShotIndex,
  isShotPlayable,
  normalizeDurationBounds,
} from './_helpers'

export interface Stage5VideoModelCapabilities {
  /** Min duration seconds allowed for the current video model. */
  minDurationSec?: number
  /** Max duration seconds allowed for the current video model. */
  maxDurationSec?: number
}

export interface Stage5ScreeningRoomViewProps {
  item: BatchItemDTO
  assetsArtifact?: AssetsArtifact | null
  storyboardArtifact: StoryboardArtifact | null
  artifact: VideoGenArtifact | null
  stageState: BatchStageState
  running: boolean
  materializing: boolean
  onGenerateVideos: (opts?: {
    shotIds?: string[]
    forceRerun?: boolean
    updatedStoryboard?: StoryboardArtifact
  }) => Promise<void>
  onSelectTake: (shotId: string, takeIndex: number) => Promise<void>
  onMaterializeCanvas: (forceNew?: boolean) => Promise<void>
  onJumpToStoryboard: () => void
  onJumpToAssets?: () => void
  onNotify?: (msg: string, tone?: 'success' | 'error' | 'info') => void
  /** Optional current model capabilities, used to clamp duration options. */
  videoCapabilities?: Stage5VideoModelCapabilities
}

function isAssetImageReady(asset: WorkflowAssetItem): boolean {
  return (asset.status === 'ready' || asset.status === 'reused') && Boolean(asset.materialId)
}

function getSelectedTake(shot: VideoGenShotEntry): VideoShotTake | null {
  if (!Array.isArray(shot.takes) || shot.takes.length === 0) return null
  if (shot.selectedTakeIndex >= 0 && shot.selectedTakeIndex < shot.takes.length) {
    return shot.takes[shot.selectedTakeIndex]
  }
  const latestReady = [...shot.takes].reverse().find((t) => t.status === 'ready')
  return latestReady || shot.takes[shot.takes.length - 1]
}

function resolveTakeVideoUrl(take: VideoShotTake | null): string | null {
  if (!take || take.status !== 'ready') return null
  return toPlayableVideoUrl(take.videoUrl || take.storageKey || null)
}

function resolveTakePosterUrl(take: VideoShotTake | null): string | null {
  if (!take) return null
  if (take.posterUrl) return take.posterUrl
  return toVideoPosterUrl(take.videoUrl || take.storageKey || null, 480)
}

function TaskStatus({ status }: { status: 'queued' | 'processing' }) {
  return (
    <div className={`wf-task-status is-${status}`} role="status">
      <span className="wf-spinner" aria-hidden="true" />
      <span>{status === 'processing' ? '生成中' : '排队中'}</span>
    </div>
  )
}

export const Stage5ScreeningRoomView = memo(function Stage5ScreeningRoomView({
  item,
  assetsArtifact = null,
  storyboardArtifact,
  artifact,
  stageState,
  running,
  materializing,
  onGenerateVideos,
  onSelectTake,
  onMaterializeCanvas,
  onJumpToStoryboard,
  onJumpToAssets,
  onNotify,
  videoCapabilities,
}: Stage5ScreeningRoomViewProps) {
  const playerRef = useRef<HTMLVideoElement>(null)
  const pendingAutoplayRef = useRef(false)
  const [activeShotIndex, setActiveShotIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [sequentialPlay, setSequentialPlay] = useState(true)
  const [editingShotId, setEditingShotId] = useState<string | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  const [editDuration, setEditDuration] = useState(5)
  const [submittingShotId, setSubmittingShotId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [videoErrorByShotId, setVideoErrorByShotId] = useState<Record<string, boolean>>({})
  const [loadedReelShotIds, setLoadedReelShotIds] = useState<Set<string>>(new Set())
  const reelObserverRef = useRef<IntersectionObserver | null>(null)
  const reelNodeMapRef = useRef<Map<string, HTMLElement>>(new Map())

  const shots: VideoGenShotEntry[] = useMemo(() => {
    if (artifact && Array.isArray(artifact.shots) && artifact.shots.length > 0) return artifact.shots
    if (storyboardArtifact && Array.isArray(storyboardArtifact.shots) && storyboardArtifact.shots.length > 0) {
      return storyboardArtifact.shots.map((sh) => ({
        shotId: sh.shotId,
        shotIndex: sh.shotIndex,
        title: sh.title,
        durationSec: sh.durationSec,
        prompt: sh.videoPrompt,
        referencedAssetIds: Array.isArray(sh.referencedAssetIds) ? sh.referencedAssetIds : [],
        takes: [],
        selectedTakeIndex: -1,
      }))
    }
    return []
  }, [artifact, storyboardArtifact])

  // Reset per-item UI state when item changes.
  useEffect(() => {
    setActiveShotIndex(0)
    setEditingShotId(null)
    setEditPrompt('')
    setEditDuration(5)
    setSubmittingShotId(null)
    setActionError(null)
    setVideoErrorByShotId({})
    setLoadedReelShotIds(new Set())
    setIsPlaying(false)
    pendingAutoplayRef.current = false
    if (playerRef.current) {
      playerRef.current.pause()
    }
  }, [item.id])

  // Lazy-load reel videos via IntersectionObserver: only mount src when card
  // becomes visible OR has been explicitly activated by the user.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver((entries) => {
      const toAdd: string[] = []
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const shotId = (entry.target as HTMLElement).dataset.shotId
          if (shotId) toAdd.push(shotId)
        }
      })
      if (toAdd.length > 0) {
        setLoadedReelShotIds((prev) => {
          const next = new Set(prev)
          toAdd.forEach((id) => next.add(id))
          return next
        })
      }
    }, { rootMargin: '240px' })
    reelObserverRef.current = obs
    reelNodeMapRef.current.forEach((node) => obs.observe(node))
    return () => {
      obs.disconnect()
      reelObserverRef.current = null
    }
  }, [shots.length])

  const registerReelNode = useCallback((shotId: string, node: HTMLElement | null) => {
    if (node) {
      reelNodeMapRef.current.set(shotId, node)
      reelObserverRef.current?.observe(node)
    } else {
      reelNodeMapRef.current.delete(shotId)
    }
  }, [])

  const stage3Assets = useMemo(() => assetsArtifact?.items || [], [assetsArtifact?.items])
  const stage3AssetById = useMemo(
    () => new Map(stage3Assets.map((a) => [a.id, a])),
    [stage3Assets],
  )

  const getUngeneratedAssetsForShots = useCallback((targetShots: VideoGenShotEntry[]): WorkflowAssetItem[] => {
    const missing: WorkflowAssetItem[] = []
    const seen = new Set<string>()
    for (const sh of targetShots) {
      const sbShot = storyboardArtifact?.shots?.find((s) => s.shotId === sh.shotId)
      const ids = Array.from(new Set([
        ...(Array.isArray(sh.referencedAssetIds) ? sh.referencedAssetIds : []),
        ...(Array.isArray(sbShot?.referencedAssetIds) ? sbShot.referencedAssetIds : []),
      ]))
      for (const id of ids) {
        if (seen.has(id)) continue
        const asset = stage3AssetById.get(id)
        if (asset && !isAssetImageReady(asset)) {
          seen.add(id)
          missing.push(asset)
        }
      }
    }
    return missing
  }, [stage3AssetById, storyboardArtifact?.shots])

  const ungeneratedReferencedAssets = useMemo(
    () => getUngeneratedAssetsForShots(shots),
    [getUngeneratedAssetsForShots, shots],
  )

  useEffect(() => {
    if (shots.length === 0) {
      setActiveShotIndex(0)
      return
    }
    if (activeShotIndex >= shots.length) {
      const firstReady = shots.findIndex((sh) => getSelectedTake(sh)?.status === 'ready')
      setActiveShotIndex(firstReady >= 0 ? firstReady : 0)
    }
  }, [activeShotIndex, shots])

  const activeShot = shots[activeShotIndex] || null
  const activeTake = activeShot ? getSelectedTake(activeShot) : null
  const activeVideoUrl = resolveTakeVideoUrl(activeTake)
  const activePosterUrl = resolveTakePosterUrl(activeTake)

  const pendingOrFailedShotIds = useMemo(() => (
    shots
      .filter((sh) => {
        const take = getSelectedTake(sh)
        return !take || take.status === 'pending' || take.status === 'failed'
      })
      .map((sh) => sh.shotId)
  ), [shots])

  const renderingCount = useMemo(
    () => shots.filter((sh) => {
      const take = getSelectedTake(sh)
      return take?.status === 'queued' || take?.status === 'processing'
    }).length,
    [shots],
  )

  const readyCount = useMemo(
    () => shots.filter((sh) => getSelectedTake(sh)?.status === 'ready').length,
    [shots],
  )

  const inlineDurationBounds = useMemo(() => normalizeDurationBounds({
    min: videoCapabilities?.minDurationSec,
    max: videoCapabilities?.maxDurationSec,
  }, storyboardArtifact?.allowedDurationRange), [storyboardArtifact?.allowedDurationRange, videoCapabilities?.minDurationSec, videoCapabilities?.maxDurationSec])
  const inlineDurationOptions = useMemo(() => durationOptions(inlineDurationBounds, editDuration), [editDuration, inlineDurationBounds])
  const displayDuration = activeShot
    ? clampDurationSec(activeShot.durationSec, inlineDurationBounds)
    : 0

  const mediaRatioClass = useMemo(() => {
    const ratio = artifact?.aspectRatio || storyboardArtifact?.aspectRatio || item.inputPayload.aspectRatio || '9:16'
    if (ratio === '9:16' || ratio === '3:4') return ' is-portrait'
    if (ratio === '1:1') return ' is-square'
    return ''
  }, [artifact?.aspectRatio, item.inputPayload.aspectRatio, storyboardArtifact?.aspectRatio])

  const togglePlayPause = useCallback(() => {
    const el = playerRef.current
    if (!el || !activeVideoUrl) return
    if (el.paused) {
      void el.play().catch(() => {})
    } else {
      el.pause()
    }
  }, [activeVideoUrl])

  // Spacebar play/pause inside Stage 5 Screening Room (short-circuited while dialogs/popovers are open)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.metaKey || event.ctrlKey || event.altKey) return
      if (document.querySelector('[role="dialog"][aria-modal="true"], .wf-popover, .fos-viewport-popover')) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, button, a'))
      ) {
        return
      }
      if (!activeVideoUrl) return
      event.preventDefault()
      togglePlayPause()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeVideoUrl, togglePlayPause])

  const handleVideoEnded = useCallback(() => {
    if (!sequentialPlay) {
      setIsPlaying(false)
      return
    }
    const nextIdx = findNextPlayableShotIndex(shots, activeShotIndex, resolveTakeVideoUrl)
    if (nextIdx >= 0) {
      pendingAutoplayRef.current = true
      setActiveShotIndex(nextIdx)
      return
    }
    setIsPlaying(false)
  }, [activeShotIndex, sequentialPlay, shots])

  const jumpShot = (delta: -1 | 1) => {
    if (shots.length === 0) return
    pendingAutoplayRef.current = false
    const next = findNavigableShotIndex(shots, activeShotIndex, delta, resolveTakeVideoUrl)
    if (next < 0) {
      onNotify?.('没有其他可用镜头。', 'info')
      return
    }
    setActiveShotIndex(next)
  }

  const safeGenerateVideos = useCallback(async (opts?: {
    shotIds?: string[]
    forceRerun?: boolean
    updatedStoryboard?: StoryboardArtifact
  }) => {
    const targetShots = opts?.shotIds && opts.shotIds.length > 0
      ? shots.filter((sh) => opts.shotIds!.includes(sh.shotId))
      : shots
    const missingAssets = getUngeneratedAssetsForShots(targetShots)
    if (missingAssets.length > 0) {
      const namesPreview = missingAssets.slice(0, 4).map((a) => `@${a.name}`).join('、')
      const suffix = missingAssets.length > 4 ? ` 等 ${missingAssets.length} 项` : ''
      const ok = await confirmAction({
        title: '被引用资产尚未出图，仍要提交生视频？',
        message: `有 ${missingAssets.length} 项被引用资产（${namesPreview}${suffix}）尚未出图，生视频将无法保持角色/场景一致且会消耗视频生成额度。建议先返回第 3 步一键出图。`,
        confirmLabel: '仍要生视频',
        cancelLabel: '取消',
      })
      if (!ok) return
    }
    setActionError(null)
    try {
      await onGenerateVideos(opts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生视频提交失败'
      setActionError(msg)
      onNotify?.(msg, 'error')
      throw err
    }
  }, [getUngeneratedAssetsForShots, onGenerateVideos, onNotify, shots])

  const runGenerateVideos = useCallback((opts?: Parameters<typeof safeGenerateVideos>[0]) => {
    void safeGenerateVideos(opts).catch(() => {})
  }, [safeGenerateVideos])

  const handleSelectTake = useCallback(async (shotId: string, takeIndex: number) => {
    pendingAutoplayRef.current = false
    setActionError(null)
    try {
      await onSelectTake(shotId, takeIndex)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '切换视频版本失败'
      setActionError(msg)
      onNotify?.(msg, 'error')
    }
  }, [onNotify, onSelectTake])

  const openInlineReroll = (shot: VideoGenShotEntry) => {
    if (editingShotId === shot.shotId) {
      setEditingShotId(null)
      return
    }
    const sbShot = storyboardArtifact?.shots.find((s) => s.shotId === shot.shotId)
    setEditingShotId(shot.shotId)
    setEditPrompt(sbShot?.videoPrompt || shot.prompt || '')
    setEditDuration(clampDurationSec(sbShot?.durationSec || shot.durationSec || 5, inlineDurationBounds))
  }

  const handleSubmitSingleReroll = async (shot: VideoGenShotEntry) => {
    setSubmittingShotId(shot.shotId)
    try {
      let updatedStoryboard: StoryboardArtifact | undefined
      if (storyboardArtifact) {
        const nextShots = storyboardArtifact.shots.map((s) => (
          s.shotId === shot.shotId
            ? { ...s, videoPrompt: editPrompt.trim() || s.videoPrompt, durationSec: editDuration }
            : s
        ))
        updatedStoryboard = {
          ...storyboardArtifact,
          shots: nextShots,
          totalDurationSec: nextShots.reduce((acc, s) => acc + (Number(s.durationSec) || 0), 0),
        }
      }
      await safeGenerateVideos({
        shotIds: [shot.shotId],
        forceRerun: true,
        updatedStoryboard,
      })
      setEditingShotId(null)
    } catch {
      // Error already surfaced via setActionError / onNotify in safeGenerateVideos.
    } finally {
      setSubmittingShotId(null)
    }
  }

  const handleRerollAll = async () => {
    if (readyCount > 0) {
      const ok = await confirmAction({
        title: '全部镜头重新抽卡？',
        message: '将为所有镜头追加新的视频版本，已生成的旧版本仍会保留在版本切换条中。',
        confirmLabel: '确认全部重抽',
      })
      if (!ok) return
    }
    await safeGenerateVideos({ forceRerun: true }).catch(() => {})
  }

  if (shots.length === 0) {
    return (
      <div className="wf-card" data-stage="video_gen">
        <div className="wf-empty">
          <span className="wf-empty-icon">
            <AppIcon name="clapperboard" className="h-5 w-5" />
          </span>
          <div className="wf-empty-title">请先完成「4. 处理分镜」生成镜头列表</div>
          <div className="wf-empty-desc">
            完成分镜后，即可在这里一键批量提交所有镜头生成视频，支持单镜多版本抽卡对比、顺序连播审片与一键展开至无限画布。
          </div>
          <div className="wf-empty-actions">
            <button type="button" className="wf-btn wf-btn-primary" onClick={onJumpToStoryboard}>
              <AppIcon name="arrowRight" className="h-3.5 w-3.5" />前往处理分镜
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4" data-stage="video_gen">
      {ungeneratedReferencedAssets.length > 0 ? (
        <div className="wf-stale-banner" role="alert">
          <div className="wf-stale-banner-main">
            <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
            <span>
              有 <strong>{ungeneratedReferencedAssets.length}</strong> 项被引用资产尚未出图（
              {ungeneratedReferencedAssets.slice(0, 4).map((a) => `@${a.name}`).join('、')}
              {ungeneratedReferencedAssets.length > 4 ? ' 等' : ''}
              ），生视频将无法保持角色/场景一致
            </span>
          </div>
          {onJumpToAssets ? (
            <div className="wf-stale-banner-actions">
              <button
                type="button"
                className="wf-btn wf-btn-warning wf-btn-xs"
                onClick={onJumpToAssets}
              >
                <AppIcon name="sparkles" className="h-3 w-3" />返回第 3 步一键出图
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Top Director's Screening Room */}
      <section className="wf-screening-stage nori-force-dark" aria-label="导演审片室">
        <div className="wf-screening-head">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <span className="wf-badge is-stage">
              <AppIcon name="clapperboard" className="h-3 w-3" />导演审片室
            </span>
            <span className="text-[13px] font-bold truncate">
              {item.title}
            </span>
            <span className="wf-badge is-success wf-num">
              {readyCount} / {shots.length} 镜已成片
            </span>
            {artifact ? (
              <span className="wf-badge is-muted wf-num">
                {artifact.aspectRatio} · {artifact.resolution} · {artifact.generateAudio ? '含音效/配音' : '静音画面'}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {pendingOrFailedShotIds.length > 0 ? (
              <button
                type="button"
                className="wf-btn wf-btn-stage wf-btn-sm"
                disabled={running}
                onClick={() => runGenerateVideos({
                  shotIds: artifact ? pendingOrFailedShotIds : undefined,
                  forceRerun: false,
                })}
              >
                {running ? <span className="wf-spinner" /> : <AppIcon name="sparkles" className="h-3.5 w-3.5" />}
                <span>
                  {artifact
                    ? `一键批量生成全部未完成镜头 (${pendingOrFailedShotIds.length})`
                    : `一键批量生成全部镜头 (${shots.length})`}
                </span>
              </button>
            ) : renderingCount > 0 ? (
              <button
                type="button"
                className="wf-btn wf-btn-stage wf-btn-sm"
                disabled
              >
                <span className="wf-spinner" />
                <span>云端批量渲染中 ({readyCount}/{shots.length})…</span>
              </button>
            ) : (
              <button
                type="button"
                className="wf-btn wf-btn-sm"
                disabled={running}
                onClick={() => void handleRerollAll()}
              >
                <AppIcon name="refresh" className="h-3.5 w-3.5" />全部追加重抽
              </button>
            )}

            <button
              type="button"
              className="wf-btn wf-btn-primary wf-btn-sm"
              disabled={materializing}
              onClick={() => {
                void onMaterializeCanvas(false).catch((err) => {
                  const msg = err instanceof Error ? err.message : '展开画布失败'
                  setActionError(msg)
                  onNotify?.(msg, 'error')
                })
              }}
            >
              {materializing ? <span className="wf-spinner" /> : <AppIcon name="monitor" className="h-3.5 w-3.5" />}
              <span>{materializing ? '正在构建画布…' : '展开到无限画布精修'}</span>
            </button>
          </div>
        </div>

        {/* Viewport */}
        <div className="wf-screening-viewport">
          {activeVideoUrl && !videoErrorByShotId[activeShot?.shotId || ''] ? (
            <video
              key={`${activeShot?.shotId}-${activeTake?.takeIndex}-${activeVideoUrl}`}
              ref={playerRef}
              src={activeVideoUrl}
              poster={activePosterUrl || undefined}
              className="wf-screening-video"
              controls
              playsInline
              muted={isMuted}
              onCanPlay={(e) => {
                if (pendingAutoplayRef.current) {
                  pendingAutoplayRef.current = false
                  void e.currentTarget.play().catch(() => {})
                }
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={handleVideoEnded}
              onError={() => {
                if (activeShot?.shotId) {
                  setVideoErrorByShotId((prev) => ({ ...prev, [activeShot.shotId]: true }))
                }
              }}
            />
          ) : activeVideoUrl && videoErrorByShotId[activeShot?.shotId || ''] ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <AppIcon name="alert" className="h-9 w-9 opacity-70" />
              <div className="text-[13.5px] font-semibold">
                镜头 S{String(activeShotIndex + 1).padStart(2, '0')} · {activeShot?.title} 视频加载失败
              </div>
              <div className="text-[12px] opacity-70">
                已生成成片但媒体暂时无法读取。可点击下方按钮重试加载。
              </div>
              <button
                type="button"
                className="wf-btn wf-btn-stage wf-btn-sm"
                onClick={() => {
                  if (activeShot?.shotId) {
                    setVideoErrorByShotId((prev) => {
                      const next = { ...prev }
                      delete next[activeShot.shotId]
                      return next
                    })
                  }
                }}
              >
                <AppIcon name="refresh" className="h-3.5 w-3.5" />重试加载
              </button>
            </div>
          ) : activeTake && (activeTake.status === 'queued' || activeTake.status === 'processing') ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <TaskStatus status={activeTake.status} />
              <div className="text-[13.5px] font-semibold">
                镜头 S{String(activeShotIndex + 1).padStart(2, '0')} · {activeShot?.title}
                {activeTake.status === 'processing' ? ' 正在生成' : ' 正在排队'}
              </div>
              <div className="text-[12px] opacity-70">
                状态将自动轮询刷新，你也可以随时切换下方其他镜头预览或继续操作。
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <AppIcon name="video" className="h-9 w-9 opacity-50" />
              <div className="text-[13.5px] font-semibold">
                镜头 S{String(activeShotIndex + 1).padStart(2, '0')} · {activeShot?.title} 尚未成片
              </div>
              {activeTake?.errorMessage ? (
                <div className="wf-badge is-danger">{activeTake.errorMessage}</div>
              ) : null}
              <button
                type="button"
                className="wf-btn wf-btn-stage wf-btn-sm"
                disabled={running || !activeShot}
                onClick={() => {
                  if (activeShot) runGenerateVideos({ shotIds: [activeShot.shotId], forceRerun: true })
                }}
              >
                <AppIcon name="sparkles" className="h-3.5 w-3.5" />立即生成本镜头
              </button>
            </div>
          )}
        </div>

        {/* Controls Bar */}
        <div className="wf-screening-controls">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="wf-btn wf-btn-sm"
              disabled={!activeVideoUrl}
              title="播放 / 暂停（Space）"
              onClick={togglePlayPause}
            >
              <AppIcon name={isPlaying ? 'pause' : 'play'} className="h-3.5 w-3.5" />
              <span>{isPlaying ? '暂停' : '播放'}</span>
            </button>
            <button
              type="button"
              className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
              title="上一镜"
              aria-label="上一镜"
              disabled={findNavigableShotIndex(shots, activeShotIndex, -1, resolveTakeVideoUrl) < 0}
              onClick={() => jumpShot(-1)}
            >
              <AppIcon name="chevronLeft" className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
              title="下一镜"
              aria-label="下一镜"
              disabled={findNavigableShotIndex(shots, activeShotIndex, 1, resolveTakeVideoUrl) < 0}
              onClick={() => jumpShot(1)}
            >
              <AppIcon name="chevronRight" className="h-4 w-4" />
            </button>

            <span className="text-[12px] wf-num opacity-85 ml-1">
              镜头 {String(activeShotIndex + 1).padStart(2, '0')} / {String(shots.length).padStart(2, '0')}
              {activeShot ? ` · ${activeShot.title}` : ''}
              {activeTake ? ` · v${activeTake.takeIndex}` : ''}
              {activeShot ? ` · 模型时长 ${displayDuration}s` : ''}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-[11.5px] opacity-85 cursor-pointer">
              <input
                type="checkbox"
                role="switch"
                className="wf-switch"
                checked={sequentialPlay}
                onChange={(e) => setSequentialPlay(e.target.checked)}
              />
              <span>多镜连续播放</span>
            </label>
            <button
              type="button"
              className="wf-btn wf-btn-ghost wf-btn-icon wf-btn-sm"
              title={isMuted ? '取消静音' : '静音'}
              aria-label={isMuted ? '取消静音' : '静音'}
              onClick={() => setIsMuted((m) => !m)}
            >
              <AppIcon name={isMuted ? 'volumeOff' : 'volume'} className="h-3.5 w-3.5" />
            </button>
            {activeVideoUrl ? (
              <a
                href={activeVideoUrl}
                download={`${item.title}-S${String(activeShotIndex + 1).padStart(2, '0')}.mp4`}
                target="_blank"
                rel="noopener noreferrer"
                className="wf-btn wf-btn-subtle wf-btn-sm"
              >
                <AppIcon name="download" className="h-3.5 w-3.5" />下载当前镜
              </a>
            ) : null}
          </div>
        </div>

        {/* Clickable Shot Timeline Segments */}
        <div className="wf-screening-timeline" role="tablist" aria-label="分镜时间轴">
          {shots.map((shot, idx) => {
            const take = getSelectedTake(shot)
            const isReady = take?.status === 'ready'
            const isPlayable = isShotPlayable(shot, resolveTakeVideoUrl)
            const isActive = idx === activeShotIndex
            return (
              <button
                key={shot.shotId || `seg-${idx}`}
                type="button"
                role="tab"
                disabled={!isPlayable}
                aria-label={`镜头 ${idx + 1}${isPlayable ? '' : '（不可播放）'}`}
                aria-selected={isActive}
                title={`S${String(idx + 1).padStart(2, '0')} · ${shot.title} (${clampDurationSec(shot.durationSec, inlineDurationBounds)}s)${isPlayable ? '' : ' · 尚无可播放版本'}`}
                className={`wf-screening-seg${isReady ? ' is-done' : ''}${isActive ? ' is-active' : ''}`}
                style={{ flexGrow: Math.max(1, shot.durationSec || 5) }}
                onClick={() => {
                  pendingAutoplayRef.current = false
                  setActiveShotIndex(idx)
                }}
              />
            )
          })}
        </div>
      </section>

      {stageState.error ? (
        <div className="wf-stale-banner">
          <div className="wf-stale-banner-main">
            <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
            <span>{stageState.error}</span>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="wf-stale-banner wf-save-error" role="alert">
          <div className="wf-stale-banner-main">
            <AppIcon name="alert" className="wf-stale-banner-icon h-4 w-4" />
            <span>{actionError}</span>
          </div>
          <div className="wf-stale-banner-actions">
            <button type="button" className="wf-btn wf-btn-ghost wf-btn-xs" onClick={() => setActionError(null)}>
              关闭
            </button>
          </div>
        </div>
      ) : null}

      {/* Bottom Shot Reel Grid */}
      <div className="wf-shot-reel">
        {shots.map((shot, idx) => {
          const shotTakes = Array.isArray(shot.takes) ? shot.takes : []
          const take = getSelectedTake(shot)
          const takeUrl = resolveTakeVideoUrl(take)
          const takePoster = resolveTakePosterUrl(take)
          const isActive = idx === activeShotIndex
          const isGenerating = take?.status === 'queued' || take?.status === 'processing'
          const isFailed = take?.status === 'failed'
          const isEditing = editingShotId === shot.shotId
          const shouldMountVideo = Boolean(takeUrl) && (
            isActive || loadedReelShotIds.has(shot.shotId)
          )
          const reelMediaError = Boolean(videoErrorByShotId[`reel-${shot.shotId}`])

          return (
            <article
              key={shot.shotId || `reel-${idx}`}
              ref={(node) => registerReelNode(shot.shotId, node)}
              data-shot-id={shot.shotId}
              className={`wf-reel-card${isActive ? ' is-active' : ''}${isFailed ? ' is-failed' : ''}`}
            >
              {/* Media Frame */}
              <div
                className={`wf-reel-media nori-force-dark${mediaRatioClass}`}
                onClick={() => {
                  pendingAutoplayRef.current = false
                  setActiveShotIndex(idx)
                  setLoadedReelShotIds((prev) => new Set(prev).add(shot.shotId))
                }}
              >
                {shouldMountVideo && !reelMediaError ? (
                  <video
                    src={takeUrl || undefined}
                    poster={takePoster || undefined}
                    muted
                    playsInline
                    preload="none"
                    onMouseEnter={(e) => {
                      void e.currentTarget.play().catch(() => {})
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause()
                      e.currentTarget.currentTime = 0
                    }}
                    onError={() => {
                      setVideoErrorByShotId((prev) => ({ ...prev, [`reel-${shot.shotId}`]: true }))
                    }}
                  />
                ) : takeUrl && reelMediaError ? (
                  <div className="wf-reel-state-overlay">
                    <AppIcon name="alert" className="h-6 w-6 opacity-75" />
                    <span className="text-[11.5px] font-medium">视频加载失败</span>
                    <button
                      type="button"
                      className="wf-btn wf-btn-stage wf-btn-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        setVideoErrorByShotId((prev) => {
                          const next = { ...prev }
                          delete next[`reel-${shot.shotId}`]
                          return next
                        })
                        setLoadedReelShotIds((prev) => new Set(prev).add(shot.shotId))
                      }}
                    >
                      <AppIcon name="refresh" className="h-3 w-3" />重试
                    </button>
                  </div>
                ) : takeUrl && !shouldMountVideo ? (
                  <div className="wf-reel-state-overlay wf-reel-lazy">
                    {takePoster ? (
                      <img src={takePoster} alt={shot.title} className="wf-reel-lazy-poster" loading="lazy" />
                    ) : null}
                    <button
                      type="button"
                      className="wf-btn wf-btn-subtle wf-btn-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        setLoadedReelShotIds((prev) => new Set(prev).add(shot.shotId))
                      }}
                    >
                      <AppIcon name="play" className="h-3 w-3" />加载预览
                    </button>
                  </div>
                ) : isGenerating ? (
                  <>
                    <div className="wf-shimmer w-full h-full" />
                    <div className="wf-reel-state-overlay">
                      <TaskStatus status={take!.status as 'queued' | 'processing'} />
                      <span className="text-[11.5px] font-semibold">
                        {take?.status === 'processing' ? 'AI 视频渲染中…' : '任务排队中…'}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="wf-reel-state-overlay">
                    <AppIcon name={isFailed ? 'alert' : 'video'} className="h-6 w-6 opacity-75" />
                    <span className="text-[11.5px] font-medium">
                      {isFailed ? (take?.errorMessage || '生成失败') : '待生成视频'}
                    </span>
                    <button
                      type="button"
                      className="wf-btn wf-btn-stage wf-btn-xs"
                      disabled={running || submittingShotId === shot.shotId}
                      onClick={(e) => {
                        e.stopPropagation()
                        void runGenerateVideos({ shotIds: [shot.shotId], forceRerun: true })
                      }}
                    >
                      <AppIcon name="sparkles" className="h-3 w-3" />{isFailed ? '重试本镜' : '生成本镜'}
                    </button>
                  </div>
                )}
              </div>

              {/* Reel Card Body */}
              <div className="wf-reel-body">
                <div className="wf-reel-head">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="wf-shot-num">S{String(idx + 1).padStart(2, '0')}</span>
                    <span className="text-[12.5px] font-bold truncate" title={shot.title}>{shot.title}</span>
                  </div>
                  <span className="wf-badge is-muted wf-num" title="按当前模型能力显示">
                    {clampDurationSec(shot.durationSec, inlineDurationBounds)}s
                  </span>
                </div>

                {/* Multi-Version Switcher Pills (v1 / v2 / v3) */}
                {shotTakes.length > 0 ? (
                  <div className="wf-take-pills" aria-label={`镜头 ${idx + 1} 多版本切换`}>
                    {shotTakes.map((t, tIdx) => {
                      const activePill = shot.selectedTakeIndex === tIdx
                      return (
                        <button
                          key={`${shot.shotId}-take-${t.takeIndex}-${tIdx}`}
                          type="button"
                          className={`wf-take-pill${activePill ? ' is-active' : ''}${t.status === 'failed' ? ' is-failed' : ''}`}
                          disabled={t.status !== 'ready'}
                          title={t.status === 'ready' ? `采用版本 v${t.takeIndex}` : `版本 v${t.takeIndex}：${t.status === 'failed' ? '生成失败' : t.status === 'processing' ? '生成中' : t.status === 'queued' ? '排队中' : '待生成'}`}
                          onClick={() => {
                            setActiveShotIndex(idx)
                            void handleSelectTake(shot.shotId, tIdx)
                          }}
                        >
                          {(t.status === 'queued' || t.status === 'processing') ? (
                            <span className="wf-spinner" style={{ width: 9, height: 9 }} />
                          ) : null}
                          <span>v{t.takeIndex}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                <p className="wf-reel-prompt" title={shot.prompt}>
                  {shot.prompt || '（暂无提示词）'}
                </p>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    className="wf-btn wf-btn-subtle wf-btn-xs"
                    onClick={() => openInlineReroll(shot)}
                  >
                    <AppIcon name={isEditing ? 'chevronUp' : 'edit'} className="h-3 w-3" />
                    <span>{isEditing ? '收起微调' : '单镜微调并重抽'}</span>
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn-ghost wf-btn-xs"
                    disabled={running || isGenerating || submittingShotId === shot.shotId}
                    onClick={() => runGenerateVideos({ shotIds: [shot.shotId], forceRerun: true })}
                  >
                    <AppIcon name="refresh" className="h-3 w-3" />快速重抽
                  </button>
                </div>

                {/* Inline Single-Shot Reroll Editor */}
                {isEditing ? (
                  <div className="wf-reel-reroll">
                    <div className="wf-field">
                      <label className="wf-label">微调此镜提示词（仅重抽本镜，追加新版本）</label>
                      <textarea
                        className="wf-textarea"
                        rows={3}
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1.5">
                        <span className="wf-param-label">时长</span>
                        <select
                          className="wf-select wf-select-sm wf-num"
                          style={{ width: 70 }}
                          value={editDuration}
                          onChange={(e) => setEditDuration(Number(e.target.value) || inlineDurationOptions[0] || 5)}
                        >
                          {inlineDurationOptions.map((sec) => (
                            <option key={sec} value={sec}>{sec}s</option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        className="wf-btn wf-btn-stage wf-btn-xs"
                        disabled={submittingShotId === shot.shotId || running}
                        onClick={() => void handleSubmitSingleReroll(shot)}
                      >
                        {submittingShotId === shot.shotId ? (
                          <span className="wf-spinner" />
                        ) : (
                          <AppIcon name="sparkles" className="h-3 w-3" />
                        )}
                        <span>提交单镜重抽</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
})
