'use client'

import { logError as _ulogError } from '@/lib/logging/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Player } from '@remotion/player'
import { AbsoluteFill, Sequence, Video } from 'remotion'
import {
  VideoToolbar,
  type VideoGenerationOptionValue,
  type VideoGenerationOptions,
  type VideoPanel,
  type VideoModelOption,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'
import { AppIcon } from '@/components/ui/icons'
import {
  useDownloadRemoteBlob,
  useListProjectEpisodeVideoUrls,
  useMatchedVoiceLines,
  useUpdateProjectPanelLink,
} from '@/lib/query/hooks'
import { useLipSync } from '@/lib/query/hooks/useStoryboards'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { ModelCapabilityDropdown } from '@/components/ui/config-modals/ModelCapabilityDropdown'
import VideoTimelinePanel from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/VideoTimelinePanel'
import VideoRenderPanel from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/VideoRenderPanel'
import type { VideoStageShellProps } from './video-stage-runtime/types'
import {
  type EffectiveVideoCapabilityDefinition,
  normalizeVideoGenerationSelections,
  resolveEffectiveVideoCapabilityDefinitions,
  resolveEffectiveVideoCapabilityFields,
} from '@/lib/model-capabilities/video-effective'
import { projectVideoPricingTiersByFixedSelections } from '@/lib/model-pricing/video-tier'
import { useVideoTaskStates } from './video-stage-runtime/useVideoTaskStates'
import { useVideoPanelsProjection } from './video-stage-runtime/useVideoPanelsProjection'
import { useVideoPromptState } from './video-stage-runtime/useVideoPromptState'
import { useVideoPanelLinking } from './video-stage-runtime/useVideoPanelLinking'
import { useVideoVoiceLines } from './video-stage-runtime/useVideoVoiceLines'
import { useVideoDownloadAll } from './video-stage-runtime/useVideoDownloadAll'
import { useVideoStageUiState } from './video-stage-runtime/useVideoStageUiState'
import { useVideoPanelViewport } from './video-stage-runtime/useVideoPanelViewport'
import { useVideoFirstLastFrameFlow } from './video-stage-runtime/useVideoFirstLastFrameFlow'
import { filterNormalVideoModelOptions } from '@/lib/model-capabilities/video-model-options'
import {
  buildVideoSubmissionKey,
  createVideoSubmissionBaseline,
  shouldResolveVideoSubmissionLock,
  type VideoSubmissionBaseline,
} from './video-stage-runtime/immediate-video-submission'
import { getAspectRatioConfig } from '@/lib/constants'

export type { VideoStageShellProps } from './video-stage-runtime/types'

type BatchCapabilityDefinition = EffectiveVideoCapabilityDefinition

interface BatchCapabilityField {
  field: string
  label: string
  labelKey?: string
  unitKey?: string
  options: VideoGenerationOptionValue[]
  disabledOptions?: VideoGenerationOptionValue[]
}

function toFieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())
}

function readPromptField(prompt: string | null | undefined, label: string): string {
  const text = typeof prompt === 'string' ? prompt : ''
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(`(?:^|\\n)${escapedLabel}[：:]\\s*([^\\n]+)`))
  return match?.[1]?.trim() || ''
}

function compactVideoPromptPreview(prompt: string | null | undefined, fallback: string): string {
  const scene = readPromptField(prompt, '场景')
  const beat = readPromptField(prompt, '剧情片段')
  const summary = [scene, beat].filter(Boolean).join('｜')
  if (summary) return summary
  const text = (fallback || '').replace(/\s+/g, ' ').trim()
  if (!text) return '分镜视频提示词待生成'
  return Array.from(text).length > 80 ? `${Array.from(text).slice(0, 79).join('')}…` : text
}

interface FinalTimelineClip {
  id: string
  src: string
  startFrame: number
  durationInFrames: number
}

function readRatioDimensions(videoRatio: string): { width: number; height: number } {
  const [rawWidth, rawHeight] = videoRatio.split(':').map((part) => Number(part))
  const ratioWidth = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 16
  const ratioHeight = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 9
  const longSide = 1920
  if (ratioWidth >= ratioHeight) {
    return {
      width: longSide,
      height: Math.round((longSide * ratioHeight) / ratioWidth),
    }
  }
  return {
    width: Math.round((longSide * ratioWidth) / ratioHeight),
    height: longSide,
  }
}

function FinalTimelineComposition({ clips }: { clips: FinalTimelineClip[] }) {
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {clips.map((clip, index) => (
        <Sequence
          key={clip.id}
          from={clip.startFrame}
          durationInFrames={clip.durationInFrames}
          name={`分镜 ${index + 1}`}
        >
          <AbsoluteFill>
            <Video
              src={clip.src}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}

function FinalCompositionPlayer({
  panels,
  videoRatio,
}: {
  panels: VideoPanel[]
  videoRatio: string
}) {
  const cssAspectRatio = videoRatio.replace(':', '/')
  const isVerticalVideo = getAspectRatioConfig(videoRatio).isVertical
  const playerWidthClass = isVerticalVideo
    ? 'max-w-[260px] sm:max-w-[280px] lg:max-w-[300px]'
    : 'max-w-[680px]'
  const { width: compositionWidth, height: compositionHeight } = readRatioDimensions(videoRatio)
  const fps = 30
  const playablePanels = useMemo(() => panels.filter((panel) => panel.videoUrl), [panels])
  const clips = useMemo(() => {
    let startFrame = 0
    return playablePanels.map((panel, index) => {
      const durationSeconds = Number(panel.textPanel?.duration)
      const durationInFrames = Math.max(1, Math.round((Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 6) * fps))
      const clip: FinalTimelineClip = {
        id: `${panel.storyboardId}-${panel.panelIndex}-${index}`,
        src: panel.videoUrl!,
        startFrame,
        durationInFrames,
      }
      startFrame += durationInFrames
      return clip
    })
  }, [playablePanels])
  const totalFrames = clips.reduce((sum, clip) => sum + clip.durationInFrames, 0)

  return (
    <div className={`mx-auto w-full overflow-hidden rounded-[18px] border border-[rgba(14,14,44,.08)] bg-black shadow-[0_16px_38px_rgba(14,14,44,.14)] ${playerWidthClass}`}>
      <div
        className="relative w-full bg-black"
        style={{ aspectRatio: cssAspectRatio }}
      >
        {clips.length > 0 ? (
          <Player
            component={FinalTimelineComposition}
            inputProps={{ clips }}
            durationInFrames={Math.max(1, totalFrames)}
            fps={fps}
            compositionWidth={compositionWidth}
            compositionHeight={compositionHeight}
            controls
            loop={false}
            style={{
              width: '100%',
              height: '100%',
            }}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-white/70">
            <AppIcon name="video" className="h-9 w-9" />
            <span className="text-sm font-semibold">还没有可播放的成片片段</span>
          </div>
        )}
        {clips.length > 0 && (
          <div className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-white backdrop-blur">
            成片预览：{clips.length} 个分镜片段
          </div>
        )}
      </div>
    </div>
  )
}

function FinalCompositionOverview({
  panels,
  videoRatio,
  videosWithUrl,
  runningCount,
  failedCount,
  isDownloading,
  downloadProgress,
  onDownloadAll,
  onBackToStoryboard,
}: {
  panels: VideoPanel[]
  videoRatio: string
  videosWithUrl: number
  runningCount: number
  failedCount: number
  isDownloading: boolean
  downloadProgress: { current: number; total: number } | null
  onDownloadAll: () => void
  onBackToStoryboard: () => void
}) {
  const totalPanels = panels.length
  const missingCount = Math.max(0, totalPanels - videosWithUrl)
  const completion = totalPanels > 0 ? Math.round((videosWithUrl / totalPanels) * 100) : 0
  const cssAspectRatio = videoRatio.replace(':', '/')
  const generatedPanels = panels.filter((panel) => panel.videoUrl)

  return (
    <div className="space-y-6 pb-20">
      <section className="overflow-hidden rounded-[22px] border border-[rgba(14,14,44,.08)] bg-[#fafcfe] shadow-[0_22px_54px_rgba(14,14,44,.085),0_4px_12px_rgba(14,14,44,.045)]">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
          <div className="p-6 lg:p-7">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[rgba(14,14,44,.08)] bg-white px-3 py-1.5 text-xs font-bold text-[#4B4DED]">
              <AppIcon name="film" className="h-3.5 w-3.5" />
              <span>成片总览</span>
            </div>
            <div className="space-y-5">
              <FinalCompositionPlayer panels={panels} videoRatio={videoRatio} />
              <div className="min-w-0">
                <h2 className="text-2xl font-bold tracking-normal text-[#0e0e2c]">按分镜顺序拼接的成片检查台</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#657184]">
                  顶部播放器会按分镜 1 到分镜 {totalPanels} 的顺序连续播放全部已生成视频，用于检查成片节奏和衔接；需要调整提示词或重新生成时回到分镜制作。
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    ['完成度', `${completion}%`],
                    ['总分镜', `${totalPanels}`],
                    ['已生成', `${videosWithUrl}`],
                    ['待处理', `${missingCount}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-[16px] border border-[rgba(14,14,44,.08)] bg-white p-3">
                      <p className="text-xs font-semibold text-[#7a8491]">{label}</p>
                      <p className="mt-1 text-xl font-bold text-[#0e0e2c]">{value}</p>
                    </div>
                  ))}
                </div>
                {(runningCount > 0 || failedCount > 0) && (
                  <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
                    {runningCount > 0 && (
                      <span className="rounded-full bg-[#eef5ff] px-3 py-1 text-[#2d65ca]">{runningCount} 个任务处理中</span>
                    )}
                    {failedCount > 0 && (
                      <span className="rounded-full bg-[var(--glass-tone-danger-bg)] px-3 py-1 text-[var(--glass-tone-danger-fg)]">{failedCount} 个生成失败</span>
                    )}
                  </div>
                )}
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onBackToStoryboard}
                    className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-4 py-2 text-sm font-semibold"
                  >
                    <AppIcon name="chevronLeft" className="h-4 w-4" />
                    <span>回到分镜制作</span>
                  </button>
                  <button
                    type="button"
                    onClick={onDownloadAll}
                    disabled={videosWithUrl === 0 || isDownloading}
                    className="glass-btn-base glass-btn-primary flex items-center gap-2 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <AppIcon name={isDownloading ? 'loader' : 'download'} className={`h-4 w-4 ${isDownloading ? 'animate-spin' : ''}`} />
                    <span>
                      {isDownloading && downloadProgress
                        ? `打包中 ${downloadProgress.current}/${downloadProgress.total}`
                        : '下载全部视频'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-[rgba(14,14,44,.08)] bg-white/70 p-5 lg:border-l lg:border-t-0">
            <p className="mb-3 text-sm font-bold text-[#0e0e2c]">成片片段顺序</p>
            <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
              {panels.map((panel, index) => (
                <div
                  key={`${panel.storyboardId}-${panel.panelIndex}`}
                  className="grid grid-cols-[44px_minmax(0,1fr)_76px] items-center gap-3 rounded-[14px] border border-[rgba(14,14,44,.07)] bg-white p-2.5"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f4f7fa] text-xs font-bold text-[#4B4DED]">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#243042]">
                      分镜 {index + 1}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[#7a8491]">
                      {panel.textPanel?.duration ? `${panel.textPanel.duration}s` : '推荐时长待确认'}
                      {' · '}
                      {compactVideoPromptPreview(panel.textPanel?.video_prompt, panel.textPanel?.description || `分镜 ${index + 1}`)}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-center text-[11px] font-bold ${
                    panel.videoUrl
                      ? 'bg-[#e0faf4] text-[#1a957c]'
                      : panel.videoTaskRunning
                        ? 'bg-[#eef5ff] text-[#2d65ca]'
                        : 'bg-[#f4f7fa] text-[#7a8491]'
                  }`}>
                    {panel.videoUrl ? '已生成' : panel.videoTaskRunning ? '生成中' : '缺视频'}
                  </span>
                </div>
              ))}
              {panels.length === 0 && (
                <div className="rounded-[16px] border border-dashed border-[rgba(14,14,44,.14)] bg-white p-8 text-center text-sm text-[#7a8491]">
                  还没有分镜。先让 Agent 完成资产和分镜生成，或回到分镜制作手动创建。
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {generatedPanels.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-[var(--glass-text-primary)]">视频片段预览</h3>
            <span className="text-sm text-[var(--glass-text-tertiary)]">{generatedPanels.length} / {totalPanels}</span>
          </div>
          <div className={`grid gap-4 ${getAspectRatioConfig(videoRatio).isVertical
            ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
            : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
          }`}>
            {generatedPanels.map((panel, index) => (
              <div key={`${panel.storyboardId}-${panel.panelIndex}`} className="overflow-hidden rounded-[18px] border border-[rgba(14,14,44,.08)] bg-white shadow-sm">
                <div className="relative bg-[#0e0e2c]" style={{ aspectRatio: cssAspectRatio }}>
                  <video
                    src={panel.videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute left-2 top-2 rounded-full bg-black/58 px-2 py-1 text-xs font-bold text-white">
                    分镜 {panels.findIndex((item) => item === panel) + 1}
                  </span>
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-xs leading-relaxed text-[#4f5b68]">
                    {compactVideoPromptPreview(panel.textPanel?.video_prompt, panel.textPanel?.description || '无视频提示词')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export function useVideoStageRuntime({
  viewMode = 'storyboard',
  projectId,
  episodeId,
  storyboards,
  clips,
  defaultVideoModel,
  capabilityOverrides,
  videoRatio = '16:9',
  userVideoModels,
  onGenerateVideo,
  onGenerateAllVideos,
  onBack,
  onUpdateVideoPrompt,
  onUpdatePanelVideoModel,
  onOpenAssetLibraryForCharacter,
  onEnterEditor,
}: VideoStageShellProps) {
  const t = useTranslations('video')

  const {
    panelVideoPreference,
    voiceLinesExpanded,
    previewImage,
    setPreviewImage,
    toggleVoiceLinesExpanded,
    toggleLipSyncVideo,
    closePreviewImage,
  } = useVideoStageUiState()

  const {
    panelRefs,
    highlightedPanelKey,
    locateVoiceLinePanel,
  } = useVideoPanelViewport()

  const lipSyncMutation = useLipSync(projectId, episodeId)
  const listEpisodeVideoUrlsMutation = useListProjectEpisodeVideoUrls(projectId)
  const updatePanelLinkMutation = useUpdateProjectPanelLink(projectId)
  const downloadRemoteBlobMutation = useDownloadRemoteBlob()
  const matchedVoiceLinesQuery = useMatchedVoiceLines(projectId, episodeId)

  const { panelVideoStates, panelLipStates } = useVideoTaskStates({
    projectId,
    storyboards,
  })
  const { allPanels } = useVideoPanelsProjection({
    storyboards,
    clips,
    panelVideoStates,
    panelLipStates,
  })

  const {
    savingPrompts,
    getLocalPrompt,
    updateLocalPrompt,
    savePrompt,
  } = useVideoPromptState({
    allPanels,
    onUpdateVideoPrompt,
  })

  const { linkedPanels, handleToggleLink } = useVideoPanelLinking({
    allPanels,
    updatePanelLinkMutation,
  })

  const {
    panelVoiceLines,
    allVoiceLines,
    runningVoiceLineIds,
    reloadVoiceLines,
  } = useVideoVoiceLines({
    projectId,
    matchedVoiceLinesQuery,
  })

  const {
    isDownloading,
    downloadProgress,
    videosWithUrl,
    handleDownloadAllVideos,
  } = useVideoDownloadAll({
    episodeId,
    t: (key) => t(key as never),
    allPanels,
    panelVideoPreference,
    listEpisodeVideoUrlsMutation,
    downloadRemoteBlobMutation,
  })

  const allVideoModelOptions = useMemo(
    () => userVideoModels || [],
    [userVideoModels],
  )
  const normalVideoModelOptions = useMemo(
    () => filterNormalVideoModelOptions(allVideoModelOptions),
    [allVideoModelOptions],
  )

  const safeTranslate = useCallback((key: string | undefined, fallback = ''): string => {
    if (!key) return fallback
    try {
      return t(key as never)
    } catch {
      return fallback
    }
  }, [t])

  const renderCapabilityLabel = useCallback((field: {
    field: string
    label: string
    labelKey?: string
    unitKey?: string
  }): string => {
    const labelText = safeTranslate(field.labelKey, safeTranslate(`capability.${field.field}`, field.label))
    const unitText = safeTranslate(field.unitKey)
    return unitText ? `${labelText} (${unitText})` : labelText
  }, [safeTranslate])

  const [isBatchConfigOpen, setIsBatchConfigOpen] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isSubmittingVideoBatch, setIsSubmittingVideoBatch] = useState(false)
  const [submittingVideoPanelKeys, setSubmittingVideoPanelKeys] = useState<Set<string>>(new Set())
  const [submittingVideoBaselines, setSubmittingVideoBaselines] = useState<Map<string, VideoSubmissionBaseline>>(new Map())
  const [batchSelectedModel, setBatchSelectedModel] = useState('')
  const [batchGenerationOptions, setBatchGenerationOptions] = useState<VideoGenerationOptions>({})

  useEffect(() => {
    if (normalVideoModelOptions.length === 0) {
      if (batchSelectedModel) setBatchSelectedModel('')
      return
    }
    if (normalVideoModelOptions.some((model) => model.value === batchSelectedModel)) return

    const nextDefault = normalVideoModelOptions.some((model) => model.value === defaultVideoModel)
      ? defaultVideoModel
      : (normalVideoModelOptions[0]?.value || '')
    setBatchSelectedModel(nextDefault)
  }, [normalVideoModelOptions, batchSelectedModel, defaultVideoModel])

  const selectedBatchModelOption = useMemo<VideoModelOption | undefined>(
    () => normalVideoModelOptions.find((option) => option.value === batchSelectedModel),
    [normalVideoModelOptions, batchSelectedModel],
  )
  const batchPricingTiers = useMemo(
    () => projectVideoPricingTiersByFixedSelections({
      tiers: selectedBatchModelOption?.videoPricingTiers ?? [],
      fixedSelections: {
        generationMode: 'normal',
      },
    }),
    [selectedBatchModelOption?.videoPricingTiers],
  )

  const batchCapabilityDefinitions = useMemo<BatchCapabilityDefinition[]>(() => {
    return resolveEffectiveVideoCapabilityDefinitions({
      videoCapabilities: selectedBatchModelOption?.capabilities?.video,
      pricingTiers: batchPricingTiers,
    })
  }, [batchPricingTiers, selectedBatchModelOption?.capabilities?.video])

  useEffect(() => {
    setBatchGenerationOptions((previous) => {
      return normalizeVideoGenerationSelections({
        definitions: batchCapabilityDefinitions,
        pricingTiers: batchPricingTiers,
        selection: previous,
      })
    })
  }, [batchCapabilityDefinitions, batchPricingTiers])

  const batchEffectiveCapabilityFields = useMemo(
    () => resolveEffectiveVideoCapabilityFields({
      definitions: batchCapabilityDefinitions,
      pricingTiers: batchPricingTiers,
      selection: batchGenerationOptions,
    }),
    [batchCapabilityDefinitions, batchGenerationOptions, batchPricingTiers],
  )

  const batchEffectiveFieldMap = useMemo(
    () => new Map(batchEffectiveCapabilityFields.map((field) => [field.field, field])),
    [batchEffectiveCapabilityFields],
  )
  const batchDefinitionFieldMap = useMemo(
    () => new Map(batchCapabilityDefinitions.map((definition) => [definition.field, definition])),
    [batchCapabilityDefinitions],
  )

  const batchCapabilityFields = useMemo<BatchCapabilityField[]>(() => {
    return batchCapabilityDefinitions.map((definition) => {
      const effectiveField = batchEffectiveFieldMap.get(definition.field)
      const enabledOptions = effectiveField?.options ?? []
      return {
        field: definition.field,
        label: toFieldLabel(definition.field),
        labelKey: definition.fieldI18n?.labelKey,
        unitKey: definition.fieldI18n?.unitKey,
        options: definition.options as VideoGenerationOptionValue[],
        disabledOptions: (definition.options as VideoGenerationOptionValue[])
          .filter((option) => !enabledOptions.includes(option)),
      }
    })
  }, [batchCapabilityDefinitions, batchEffectiveFieldMap])

  const batchMissingCapabilityFields = useMemo(
    () => batchEffectiveCapabilityFields
      .filter((field) => field.options.length === 0 || field.value === undefined)
      .map((field) => field.field),
    [batchEffectiveCapabilityFields],
  )

  const setBatchCapabilityValue = useCallback((field: string, rawValue: string) => {
    const capabilityDefinition = batchDefinitionFieldMap.get(field)
    if (!capabilityDefinition || capabilityDefinition.options.length === 0) return
    const sample = capabilityDefinition.options[0]
    const parsedValue =
      typeof sample === 'number'
        ? Number(rawValue)
        : typeof sample === 'boolean'
          ? rawValue === 'true'
          : rawValue
    if (!capabilityDefinition.options.includes(parsedValue)) return
    setBatchGenerationOptions((previous) => ({
      ...normalizeVideoGenerationSelections({
        definitions: batchCapabilityDefinitions,
        pricingTiers: batchPricingTiers,
        selection: {
          ...previous,
          [field]: parsedValue,
        },
        pinnedFields: [field],
      }),
    }))
  }, [batchCapabilityDefinitions, batchDefinitionFieldMap, batchPricingTiers])

  const handleLipSync = useCallback(async (
    storyboardId: string,
    panelIndex: number,
    voiceLineId: string,
    panelId?: string,
  ) => {
    try {
      await lipSyncMutation.mutateAsync({
        storyboardId,
        panelIndex,
        voiceLineId,
        panelId,
      })
    } catch (error: unknown) {
      _ulogError('Lip sync error:', error)
      throw error
    }
  }, [lipSyncMutation])

  const panelBySubmissionKey = useMemo(() => {
    const next = new Map<string, (typeof allPanels)[number]>()
    for (const panel of allPanels) {
      next.set(buildVideoSubmissionKey(panel), panel)
    }
    return next
  }, [allPanels])

  const handleGenerateVideoWithImmediateLock = useCallback(async (
    storyboardId: string,
    panelIndex: number,
    videoModel?: string,
    firstLastFrame?: {
      lastFrameStoryboardId: string
      lastFramePanelIndex: number
      flModel: string
      customPrompt?: string
    },
    generationOptions?: VideoGenerationOptions,
    panelId?: string,
  ) => {
    if (isSubmittingVideoBatch) return

    const panelKey = buildVideoSubmissionKey({ panelId, storyboardId, panelIndex })
    const currentPanel = panelBySubmissionKey.get(panelKey)
    if (currentPanel?.videoTaskRunning || submittingVideoPanelKeys.has(panelKey)) return

    setSubmittingVideoPanelKeys((previous) => {
      if (previous.has(panelKey)) return previous
      const next = new Set(previous)
      next.add(panelKey)
      return next
    })
    if (currentPanel) {
      setSubmittingVideoBaselines((previous) => {
        const next = new Map(previous)
        next.set(panelKey, createVideoSubmissionBaseline(currentPanel))
        return next
      })
    }

    try {
      await onGenerateVideo(storyboardId, panelIndex, videoModel, firstLastFrame, generationOptions, panelId)
    } catch (error) {
      setSubmittingVideoPanelKeys((previous) => {
        if (!previous.has(panelKey)) return previous
        const next = new Set(previous)
        next.delete(panelKey)
        return next
      })
      setSubmittingVideoBaselines((previous) => {
        if (!previous.has(panelKey)) return previous
        const next = new Map(previous)
        next.delete(panelKey)
        return next
      })
      throw error
    }
  }, [
    isSubmittingVideoBatch,
    onGenerateVideo,
    panelBySubmissionKey,
    submittingVideoPanelKeys,
  ])

  const {
    flModel,
    flModelOptions,
    flGenerationOptions,
    flCapabilityFields,
    flMissingCapabilityFields,
    flCustomPrompts,
    setFlModel,
    setFlCapabilityValue,
    setFlCustomPrompt,
    resetFlCustomPrompt,
    handleGenerateFirstLastFrame,
    getDefaultFlPrompt,
    getNextPanel,
    isLinkedAsLastFrame,
  } = useVideoFirstLastFrameFlow({
    allPanels,
    linkedPanels,
    videoModelOptions: allVideoModelOptions,
    onGenerateVideo: handleGenerateVideoWithImmediateLock,
    t: (key) => t(key as never),
  })

  useEffect(() => {
    if (submittingVideoPanelKeys.size === 0) return

    const now = Date.now()
    setSubmittingVideoPanelKeys((previous) => {
      let changed = false
      const next = new Set(previous)
      for (const key of previous) {
        if (!shouldResolveVideoSubmissionLock(panelBySubmissionKey.get(key), submittingVideoBaselines.get(key), now)) {
          continue
        }
        next.delete(key)
        changed = true
      }
      return changed ? next : previous
    })
    setSubmittingVideoBaselines((previous) => {
      let changed = false
      const next = new Map(previous)
      for (const key of previous.keys()) {
        if (submittingVideoPanelKeys.has(key) && !shouldResolveVideoSubmissionLock(panelBySubmissionKey.get(key), previous.get(key), now)) {
          continue
        }
        next.delete(key)
        changed = true
      }
      return changed ? next : previous
    })
  }, [panelBySubmissionKey, submittingVideoBaselines, submittingVideoPanelKeys])

  useEffect(() => {
    if (!isSubmittingVideoBatch || allPanels.some((panel) => panel.videoTaskRunning)) {
      if (isSubmittingVideoBatch && allPanels.some((panel) => panel.videoTaskRunning)) {
        setIsSubmittingVideoBatch(false)
      }
      return
    }

    const timeoutId = window.setTimeout(() => {
      setIsSubmittingVideoBatch(false)
    }, 90_000)
    return () => window.clearTimeout(timeoutId)
  }, [allPanels, isSubmittingVideoBatch])

  const handleGenerateAllVideosWithImmediateLock = useCallback(async (options?: Parameters<typeof onGenerateAllVideos>[0]) => {
    if (isSubmittingVideoBatch) return
    setIsSubmittingVideoBatch(true)
    try {
      await onGenerateAllVideos(options)
    } catch (error) {
      setIsSubmittingVideoBatch(false)
      throw error
    }
  }, [isSubmittingVideoBatch, onGenerateAllVideos])

  const projectedPanels = useMemo(() => (
    allPanels.map((panel) => {
      const panelKey = buildVideoSubmissionKey(panel)
      if (panel.videoUrl && isSubmittingVideoBatch && !submittingVideoPanelKeys.has(panelKey)) return panel
      if (!isSubmittingVideoBatch && !submittingVideoPanelKeys.has(panelKey)) return panel
      return {
        ...panel,
        videoTaskRunning: true,
      }
    })
  ), [allPanels, isSubmittingVideoBatch, submittingVideoPanelKeys])

  const runningCount = projectedPanels.filter((panel) => panel.videoTaskRunning || panel.lipSyncTaskRunning).length
  const failedCount = allPanels.filter((panel) => !!panel.videoErrorMessage || !!panel.lipSyncErrorMessage).length
  const isAnyTaskRunning = runningCount > 0 || isSubmittingVideoBatch
  const canSubmitBatchGenerate = !!batchSelectedModel && batchMissingCapabilityFields.length === 0

  const handleOpenBatchGenerateModal = useCallback(() => {
    if (isAnyTaskRunning) return
    setIsBatchConfigOpen(true)
  }, [isAnyTaskRunning])

  const handleCloseBatchGenerateModal = useCallback(() => {
    setIsBatchConfigOpen(false)
  }, [])

  const handleConfirmBatchGenerate = useCallback(async () => {
    if (!canSubmitBatchGenerate || isConfirming) return

    setIsConfirming(true)
    try {
      await handleGenerateAllVideosWithImmediateLock({
        videoModel: batchSelectedModel,
        generationOptions: batchGenerationOptions,
      })
      setIsBatchConfigOpen(false)
    } finally {
      setIsConfirming(false)
    }
  }, [
    batchGenerationOptions,
    batchSelectedModel,
    canSubmitBatchGenerate,
    handleGenerateAllVideosWithImmediateLock,
    isConfirming,
  ])

  if (viewMode === 'final') {
    return (
      <FinalCompositionOverview
        panels={projectedPanels}
        videoRatio={videoRatio}
        videosWithUrl={videosWithUrl}
        runningCount={runningCount}
        failedCount={failedCount}
        isDownloading={isDownloading}
        downloadProgress={downloadProgress}
        onDownloadAll={handleDownloadAllVideos}
        onBackToStoryboard={onBack}
      />
    )
  }

  return (
    <div className="space-y-6 pb-20">
      <VideoToolbar
        totalPanels={projectedPanels.length}
        runningCount={runningCount}
        videosWithUrl={videosWithUrl}
        failedCount={failedCount}
        isAnyTaskRunning={isAnyTaskRunning}
        isDownloading={isDownloading}
        onGenerateAll={handleOpenBatchGenerateModal}
        onDownloadAll={handleDownloadAllVideos}
        onBack={onBack}
        onEnterEditor={onEnterEditor}
        videosReady={videosWithUrl > 0}
      />

      <VideoTimelinePanel
        projectId={projectId}
        episodeId={episodeId}
        allVoiceLines={allVoiceLines}
        expanded={voiceLinesExpanded}
        onToggleExpanded={toggleVoiceLinesExpanded}
        onReloadVoiceLines={reloadVoiceLines}
        onLocateVoiceLine={locateVoiceLinePanel}
        onOpenAssetLibraryForCharacter={onOpenAssetLibraryForCharacter}
      />

      <VideoRenderPanel
        allPanels={projectedPanels}
        linkedPanels={linkedPanels}
        highlightedPanelKey={highlightedPanelKey}
        panelRefs={panelRefs}
        videoRatio={videoRatio}
        defaultVideoModel={defaultVideoModel}
        capabilityOverrides={capabilityOverrides}
        userVideoModels={normalVideoModelOptions}
        projectId={projectId}
        episodeId={episodeId}
        runningVoiceLineIds={runningVoiceLineIds}
        panelVoiceLines={panelVoiceLines}
        panelVideoPreference={panelVideoPreference}
        savingPrompts={savingPrompts}
        flModel={flModel}
        flModelOptions={flModelOptions}
        flGenerationOptions={flGenerationOptions}
        flCapabilityFields={flCapabilityFields}
        flMissingCapabilityFields={flMissingCapabilityFields}
        flCustomPrompts={flCustomPrompts}
        onGenerateVideo={handleGenerateVideoWithImmediateLock}
        onUpdatePanelVideoModel={onUpdatePanelVideoModel}
        onLipSync={handleLipSync}
        onToggleLink={handleToggleLink}
        onFlModelChange={setFlModel}
        onFlCapabilityChange={setFlCapabilityValue}
        onFlCustomPromptChange={setFlCustomPrompt}
        onResetFlPrompt={resetFlCustomPrompt}
        onGenerateFirstLastFrame={handleGenerateFirstLastFrame}
        onPreviewImage={setPreviewImage}
        onToggleLipSyncVideo={toggleLipSyncVideo}
        getNextPanel={getNextPanel}
        isLinkedAsLastFrame={isLinkedAsLastFrame}
        getDefaultFlPrompt={getDefaultFlPrompt}
        getLocalPrompt={getLocalPrompt}
        updateLocalPrompt={updateLocalPrompt}
        savePrompt={savePrompt}
      />

      {isBatchConfigOpen && (
        <div
          className="fixed inset-0 z-[120] glass-overlay flex items-center justify-center p-4"
          onClick={handleCloseBatchGenerateModal}
        >
          <div
            className="glass-surface-modal w-full max-w-2xl p-5 space-y-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">
                {t('toolbar.batchConfigTitle')}
              </h3>
              <p className="text-sm text-[var(--glass-text-tertiary)]">
                {t('toolbar.batchConfigDesc')}
              </p>
            </div>

            <ModelCapabilityDropdown
              models={normalVideoModelOptions}
              value={batchSelectedModel || undefined}
              onModelChange={setBatchSelectedModel}
              capabilityFields={batchCapabilityFields.map((field) => ({
                field: field.field,
                label: renderCapabilityLabel(field),
                options: field.options,
                disabledOptions: field.disabledOptions,
              }))}
              capabilityOverrides={batchGenerationOptions}
              onCapabilityChange={(field, rawValue) => setBatchCapabilityValue(field, rawValue)}
              placeholder={t('panelCard.selectModel')}
            />

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleCloseBatchGenerateModal}
                className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm font-medium"
              >
                {t('panelCard.cancel')}
              </button>
              <button
                type="button"
                onClick={() => { void handleConfirmBatchGenerate() }}
                disabled={!canSubmitBatchGenerate || isConfirming}
                className="glass-btn-base glass-btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isConfirming ? (
                  <>
                    <AppIcon name="loader" className="animate-spin h-4 w-4" />
                    <span>{t('toolbar.confirming')}</span>
                  </>
                ) : (
                  <span>{t('toolbar.confirmGenerateAll')}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewImage && <ImagePreviewModal imageUrl={previewImage} onClose={closePreviewImage} />}
    </div>
  )
}
