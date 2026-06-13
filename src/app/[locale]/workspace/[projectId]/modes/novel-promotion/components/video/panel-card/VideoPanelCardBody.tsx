import { ModelCapabilityDropdown } from '@/components/ui/config-modals/ModelCapabilityDropdown'
import { AppIcon } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import type { PanelSeedanceReferenceAsset } from '@/lib/novel-promotion/seedance-reference-assets'
import type { VideoPanelRuntime } from './hooks/useVideoPanelActions'

interface VideoPanelCardBodyProps {
  runtime: VideoPanelRuntime
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

function referenceKindLabel(kind: PanelSeedanceReferenceAsset['kind']) {
  if (kind === 'character') return '角色'
  if (kind === 'location') return '场景'
  return '道具'
}

function readCharacterName(value: string | { name?: string; appearance?: string }): string {
  if (typeof value === 'string') return value
  return value.name || ''
}

export default function VideoPanelCardBody({ runtime }: VideoPanelCardBodyProps) {
  const {
    t,
    panel,
    layout,
    actions,
    taskStatus,
    videoModel,
    promptEditor,
  } = runtime

  const promptValue = promptEditor.isEditing ? promptEditor.editingPrompt : promptEditor.localPrompt
  const references = panel.textPanel?.seedanceReferenceAssets || []
  const characterNames = (panel.textPanel?.characters || []).map(readCharacterName).filter(Boolean)
  const locationName = panel.textPanel?.location || ''
  const canGenerate =
    !taskStatus.isVideoTaskRunning
    && Boolean(videoModel.selectedModel)
    && videoModel.missingCapabilityFields.length === 0
    && Boolean(promptValue.trim())

  const safeTranslate = (key: string | undefined, fallback = ''): string => {
    if (!key) return fallback
    try {
      return t(key as never)
    } catch {
      return fallback
    }
  }

  const renderCapabilityLabel = (field: {
    field: string
    label: string
    labelKey?: string
    unitKey?: string
  }): string => {
    const labelText = safeTranslate(field.labelKey, safeTranslate(`capability.${field.field}`, field.label))
    const unitText = safeTranslate(field.unitKey)
    return unitText ? `${labelText} (${unitText})` : labelText
  }

  const handlePromptChange = (value: string) => {
    if (!promptEditor.isEditing) {
      promptEditor.handleStartEdit()
    }
    promptEditor.setEditingPrompt(value)
  }

  const handleGenerateVideo = async () => {
    if (promptEditor.isEditing) {
      await promptEditor.handleSave()
    }
    actions.onGenerateVideo(
      panel.storyboardId,
      panel.panelIndex,
      videoModel.selectedModel,
      undefined,
      videoModel.generationOptions,
      panel.panelId,
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 p-4 lg:p-5">
      <section className="min-h-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-[var(--glass-text-primary)]">视频提示词</h4>
          {panel.textPanel?.duration ? (
            <span className="text-xs text-[var(--glass-text-tertiary)]">{panel.textPanel.duration}秒</span>
          ) : null}
        </div>
        <textarea
          value={promptValue}
          onFocus={promptEditor.handleStartEdit}
          onChange={(event) => handlePromptChange(event.target.value)}
          rows={12}
          className="max-h-[380px] min-h-[240px] w-full resize-y rounded-xl border border-[var(--glass-border-medium)] bg-[var(--glass-bg-surface)] p-3 text-sm leading-6 text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-stroke-focus)] focus:ring-2 focus:ring-[var(--glass-stroke-focus)]/20"
          placeholder="当前分镜没有视频提示词"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {promptEditor.isEditing ? (
            <>
              <button
                type="button"
                onClick={() => void promptEditor.handleSave()}
                disabled={promptEditor.isSavingPrompt}
                className="rounded-lg bg-[var(--glass-accent-from)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {promptEditor.isSavingPrompt ? '保存中' : '保存提示词'}
              </button>
              <button
                type="button"
                onClick={promptEditor.handleCancelEdit}
                disabled={promptEditor.isSavingPrompt}
                className="rounded-lg border border-[var(--glass-border-medium)] px-3 py-1.5 text-xs font-semibold text-[var(--glass-text-secondary)] disabled:opacity-60"
              >
                取消
              </button>
            </>
          ) : null}
          {!promptValue.trim() ? (
            <span className="text-xs text-[var(--glass-tone-danger-fg)]">缺少 video_prompt</span>
          ) : null}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-[var(--glass-text-primary)]">分镜对应资产</h4>
          <span className="text-xs text-[var(--glass-text-tertiary)]">{references.length} 个 reference</span>
        </div>

        {references.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {references.map((asset) => {
              const imageUrl = normalizeMediaUrl(asset.imageUrl)
              return (
                <div
                  key={`${asset.kind}-${asset.name}-${asset.imageUrl}`}
                  className="min-w-0 overflow-hidden rounded-lg border border-[var(--glass-border-light)] bg-[var(--glass-bg-muted)]"
                  title={`${referenceKindLabel(asset.kind)}：${asset.name}`}
                >
                  <div className="aspect-square bg-[var(--glass-bg-muted)]">
                    {isPreviewableMediaUrl(imageUrl) ? (
                      <img src={imageUrl} alt={asset.name} className="h-full w-full object-cover" />
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
              )
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--glass-border-medium)] p-3 text-sm text-[var(--glass-text-tertiary)]">
            暂无 reference 图。当前分镜资产：{[
              characterNames.length > 0 ? `角色=${characterNames.join('、')}` : '',
              locationName ? `场景=${locationName}` : '',
            ].filter(Boolean).join('；') || '未绑定'}
          </div>
        )}
      </section>

      <section className="mt-auto border-t border-[var(--glass-border-light)] pt-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <button
            type="button"
            onClick={() => void handleGenerateVideo()}
            disabled={!canGenerate}
            className="flex h-12 min-w-[180px] items-center justify-center gap-2 rounded-xl bg-[var(--glass-accent-from)] px-4 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <AppIcon name={taskStatus.isVideoTaskRunning ? 'loader' : 'videoAlt'} className={`h-4 w-4 ${taskStatus.isVideoTaskRunning ? 'animate-spin' : ''}`} />
            <span>{panel.videoUrl ? '重新生成视频' : taskStatus.isVideoTaskRunning ? '视频生成中' : '生成视频'}</span>
          </button>

          <div className="min-w-0 flex-1">
            <ModelCapabilityDropdown
              compact
              models={videoModel.videoModelOptions}
              value={videoModel.selectedModel || undefined}
              onModelChange={(modelKey) => {
                videoModel.setSelectedModel(modelKey)
              }}
              capabilityFields={videoModel.capabilityFields.map((field) => ({
                field: field.field,
                label: renderCapabilityLabel(field),
                options: field.options,
                disabledOptions: field.disabledOptions,
              }))}
              capabilityOverrides={videoModel.generationOptions}
              onCapabilityChange={(field, rawValue) => videoModel.setCapabilityValue(field, rawValue)}
              placeholder={t('panelCard.selectModel')}
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--glass-text-tertiary)]">
          <span>{videoModel.selectedModel || '未选择视频模型'}</span>
          <span>{references.length > 0 ? '将传入 reference 图' : '无 reference 图'}</span>
          {layout.isLinked ? <span>首尾帧链接已忽略，当前按单分镜视频生成</span> : null}
        </div>

        {panel.videoErrorMessage && !taskStatus.isVideoTaskRunning ? (
          <p className="mt-2 rounded-lg bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-xs text-[var(--glass-tone-danger-fg)]">
            {panel.videoErrorMessage}
          </p>
        ) : null}
      </section>
    </div>
  )
}
