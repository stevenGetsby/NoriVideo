'use client'

import { useMemo, useState } from 'react'
import type { NovelPromotionPanel } from '@/types/project'
import type { PanelEditData } from '../PanelEditForm'
import { StoryboardPanel } from './hooks/useStoryboardState'
import { GlassSurface } from '@/components/ui/primitives'
import { AppIcon } from '@/components/ui/icons'
import { useOptionalWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import { PANEL_SEEDANCE_REFERENCE_ASSETS_KEY } from '@/lib/novel-promotion/seedance-reference-assets'
import { toDisplayImageUrl } from '@/lib/media/image-url'

interface PanelCandidateData {
  candidates: string[]
  selectedIndex: number
}

interface PanelCardProps {
  panel: StoryboardPanel
  panelData: PanelEditData
  imageUrl: string | null
  globalPanelNumber: number
  storyboardId: string
  videoRatio: string
  isSaving: boolean
  hasUnsavedChanges?: boolean
  saveErrorMessage?: string | null
  isDeleting: boolean
  isModifying: boolean
  isSubmittingPanelImageTask: boolean
  failedError: string | null
  candidateData: PanelCandidateData | null
  previousImageUrl?: string | null
  onUpdate: (updates: Partial<PanelEditData>) => void
  onDelete: () => void
  onOpenCharacterPicker: () => void
  onOpenLocationPicker: () => void
  onRetrySave?: () => void
  onRemoveCharacter: (index: number) => void
  onRemoveLocation: () => void
  onConfirmAssetUsage: (actingNotes: string | null) => Promise<void>
  onRegeneratePanelImage: (panelId: string, count?: number, force?: boolean) => void
  onOpenEditModal: () => void
  onOpenAIDataModal: () => void
  onSelectCandidateIndex: (panelId: string, index: number) => void
  onConfirmCandidate: (panelId: string, imageUrl: string) => Promise<void>
  onCancelCandidate: (panelId: string) => void
  onClearError: () => void
  onUndo?: (panelId: string) => void
  onPreviewImage?: (url: string) => void
  onInsertAfter?: () => void
  onVariant?: () => void
  isInsertDisabled?: boolean
}

type SeedanceReferenceAssetPreview = {
  kind: 'character' | 'location' | 'prop'
  name: string
  imageUrl: string
}

function normalizeMediaUrl(value: string | null | undefined): string {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''
  if (/^asset:\/\//i.test(trimmed)) return trimmed
  const displayUrl = toDisplayImageUrl(trimmed)
  if (displayUrl) return displayUrl
  if (/^(https?:|data:|blob:|\/)/i.test(trimmed)) return trimmed
  return `/${trimmed}`
}

function isPreviewableMediaUrl(value: string): boolean {
  return Boolean(value) && !/^asset:\/\//i.test(value)
}

function parseSeedanceReferenceAssets(actingNotes: string | null | undefined): SeedanceReferenceAssetPreview[] {
  if (!actingNotes) return []
  try {
    const parsed = JSON.parse(actingNotes)
    const raw = parsed?.[PANEL_SEEDANCE_REFERENCE_ASSETS_KEY]
    if (!Array.isArray(raw)) return []
    return raw
      .map((item): SeedanceReferenceAssetPreview | null => {
        if (!item || typeof item !== 'object') return null
        const source = item as Record<string, unknown>
        const kind = source.kind
        const name = typeof source.name === 'string' ? source.name.trim() : ''
        const imageUrl = normalizeMediaUrl(typeof source.imageUrl === 'string' ? source.imageUrl : '')
        if ((kind !== 'character' && kind !== 'location' && kind !== 'prop') || !name || !imageUrl) return null
        return { kind, name, imageUrl }
      })
      .filter((item): item is SeedanceReferenceAssetPreview => Boolean(item))
  } catch {
    return []
  }
}

function referenceKindLabel(kind: SeedanceReferenceAssetPreview['kind']) {
  if (kind === 'character') return '角色'
  if (kind === 'location') return '场景'
  return '道具'
}

function compactPromptPreview(prompt: string): string {
  const source = prompt.trim()
  if (!source) return ''
  return source
    .replace(/^[-—\s【】分镜\d｜|此分镜秒数参考：\d+秒，以原视频对应画面为准]+/u, '')
    .trim()
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return '生成视频失败'
}

export default function PanelCard({
  panel,
  panelData,
  globalPanelNumber,
  storyboardId,
  videoRatio,
  hasUnsavedChanges,
  onUpdate,
}: PanelCardProps) {
  const runtime = useOptionalWorkspaceStageRuntime()
  const [isSubmittingVideo, setIsSubmittingVideo] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const seedanceReferenceAssets = useMemo(
    () => parseSeedanceReferenceAssets(panelData.actingNotes ?? panel.actingNotes),
    [panel.actingNotes, panelData.actingNotes],
  )
  const videoPrompt = panelData.videoPrompt ?? panel.video_prompt ?? ''
  const selectedVideoModel = runtime?.videoModel || runtime?.userVideoModels?.[0]?.value || ''
  const isBusy = Boolean(panel.videoTaskRunning || isSubmittingVideo)
  const videoUrl = normalizeMediaUrl(panel.videoUrl)
  const promptRows = Math.min(16, Math.max(8, Math.ceil(videoPrompt.length / 70)))

  const handleGenerateVideo = async () => {
    setLocalError(null)
    if (!runtime) {
      setLocalError('当前工作区视频生成运行时未初始化，请刷新页面后再试')
      return
    }
    if (!selectedVideoModel) {
      setLocalError('请先在个人配置里选择视频生成模型')
      return
    }
    if (!videoPrompt.trim()) {
      setLocalError('当前分镜没有 video_prompt，不能生成视频')
      return
    }
    if (seedanceReferenceAssets.length === 0) {
      setLocalError('当前分镜没有绑定角色/场景/道具参考资产，不能生成视频')
      return
    }

    setIsSubmittingVideo(true)
    try {
      if ((panel.video_prompt || '') !== videoPrompt) {
        await runtime.onUpdateVideoPrompt(storyboardId, panel.panelIndex, videoPrompt, 'videoPrompt')
      }
      await runtime.onGenerateVideo(
        storyboardId,
        panel.panelIndex,
        selectedVideoModel,
        undefined,
        undefined,
        panel.id,
      )
    } catch (error) {
      setLocalError(readErrorMessage(error))
    } finally {
      setIsSubmittingVideo(false)
    }
  }

  return (
    <GlassSurface
      variant="elevated"
      padded={false}
      className="relative overflow-hidden border border-[var(--glass-border-light)] bg-[var(--glass-bg-surface)]"
      data-storyboard-id={storyboardId}
      data-panel-id={panel.id}
    >
      <div className="grid gap-0 lg:grid-cols-[minmax(280px,36%)_1fr]">
        <div className="relative min-h-[360px] bg-black/[0.03] lg:min-h-[520px]" style={{ aspectRatio: videoRatio.replace(':', '/') }}>
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              playsInline
              className="h-full w-full bg-black object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[var(--glass-bg-muted)]">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-[var(--glass-text-tertiary)] text-[var(--glass-text-tertiary)]">
                <AppIcon name="play" className="h-8 w-8" />
              </div>
            </div>
          )}
          <div className="absolute left-3 top-3 rounded-md bg-black/45 px-2 py-1 text-xs font-semibold text-white">
            SH{String(globalPanelNumber).padStart(2, '0')}
          </div>
          {panel.videoTaskRunning && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
              <div className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-2 text-sm">
                <AppIcon name="loader" className="h-4 w-4 animate-spin" />
                <span>视频生成中</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-4 p-4 lg:p-5">
          <section className="min-h-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-[var(--glass-text-primary)]">视频提示词</h4>
              {panelData.duration ? (
                <span className="text-xs text-[var(--glass-text-tertiary)]">{panelData.duration}秒</span>
              ) : null}
            </div>
            <textarea
              value={videoPrompt}
              onChange={(event) => onUpdate({ videoPrompt: event.target.value })}
              rows={promptRows}
              className="max-h-[360px] min-h-[220px] w-full resize-y rounded-xl border border-[var(--glass-border-medium)] bg-[var(--glass-bg-surface)] p-3 text-sm leading-6 text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-stroke-focus)] focus:ring-2 focus:ring-[var(--glass-stroke-focus)]/20"
              placeholder="当前分镜没有视频提示词"
            />
            {!videoPrompt.trim() && (
              <p className="mt-1 text-xs text-[var(--glass-tone-danger-fg)]">缺少 video_prompt</p>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-[var(--glass-text-primary)]">分镜对应资产</h4>
              <span className="text-xs text-[var(--glass-text-tertiary)]">{seedanceReferenceAssets.length} 个 reference</span>
            </div>
            {seedanceReferenceAssets.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {seedanceReferenceAssets.map((asset) => (
                  <div
                    key={`${asset.kind}-${asset.name}-${asset.imageUrl}`}
                    className="min-w-0 overflow-hidden rounded-lg border border-[var(--glass-border-light)] bg-[var(--glass-bg-muted)]"
                    title={`${referenceKindLabel(asset.kind)}：${asset.name}`}
                  >
                    <div className="aspect-square bg-[var(--glass-bg-muted)]">
                      {isPreviewableMediaUrl(asset.imageUrl) ? (
                        <img src={asset.imageUrl} alt={asset.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] font-semibold text-[var(--glass-text-tertiary)]">
                          Seedance Asset
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 px-2 py-1.5">
                      <div className="truncate text-[11px] font-medium text-[var(--glass-text-primary)]">{asset.name}</div>
                      <div className="text-[10px] text-[var(--glass-text-tertiary)]">{referenceKindLabel(asset.kind)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--glass-border-medium)] p-3 text-sm text-[var(--glass-text-tertiary)]">
                暂无绑定资产
              </div>
            )}
          </section>

          <section className="mt-auto border-t border-[var(--glass-border-light)] pt-4">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleGenerateVideo}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--glass-accent-from)] px-4 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[180px]"
              title={selectedVideoModel ? `使用 ${selectedVideoModel} 生成视频` : '请先配置视频生成模型'}
            >
              <AppIcon name={isBusy ? 'loader' : 'videoAlt'} className={`h-4 w-4 ${isBusy ? 'animate-spin' : ''}`} />
              <span>{isBusy ? '提交中 / 生成中' : videoUrl ? '重新生成视频' : '生成视频'}</span>
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--glass-text-tertiary)]">
              <span className="min-w-0 truncate">{selectedVideoModel || '未配置视频模型'}</span>
              <span>{seedanceReferenceAssets.length > 0 ? '将传入 reference 图' : '无 reference 图'}</span>
              {hasUnsavedChanges ? <span>生成前会自动保存当前提示词</span> : null}
            </div>
            {(localError || panel.videoErrorMessage) && (
              <p className="mt-2 rounded-lg bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-xs text-[var(--glass-tone-danger-fg)]">
                {localError || panel.videoErrorMessage}
              </p>
            )}
          </section>
        </div>
      </div>
      <span className="sr-only">{compactPromptPreview(videoPrompt)}</span>
    </GlassSurface>
  )
}

type _PanelCardProjectTypeGuard = NovelPromotionPanel
