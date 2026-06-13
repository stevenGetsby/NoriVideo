'use client'

import { CapsuleNav, EpisodeSelector } from '@/components/ui/CapsuleNav'
import { SettingsModal, WorldContextModal } from '@/components/ui/ConfigModals'
import WorkspaceTopActions from './WorkspaceTopActions'
import { AppIcon } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import type { NovelPromotionPanel } from '@/types/project'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/model-config-contract'
import { resolveEpisodeStageArtifacts } from '@/lib/novel-promotion/stage-readiness'
import type { CapsuleNavItem } from '../hooks/useWorkspaceStageNavigation'

interface EpisodeSummary {
  id: string
  name: string
  episodeNumber?: number
  description?: string | null
  clips?: unknown[]
  storyboards?: Array<{
    panels?: NovelPromotionPanel[] | null
  }>
}

interface UserModelOption {
  value: string
  label: string
  provider?: string
  providerName?: string
  capabilities?: ModelCapabilities
}

interface UserModelsPayload {
  llm: UserModelOption[]
  vision: UserModelOption[]
  image: UserModelOption[]
  video: UserModelOption[]
  audio: UserModelOption[]
  lipsync?: UserModelOption[]
}

interface WorkspaceHeaderShellProps {
  isSettingsModalOpen: boolean
  isWorldContextModalOpen: boolean
  onCloseSettingsModal: () => void
  onCloseWorldContextModal: () => void
  availableModels?: UserModelsPayload
  modelsLoaded: boolean
  artStyle: string | null | undefined
  analysisModel: string | null | undefined
  characterModel: string | null | undefined
  locationModel: string | null | undefined
  storyboardModel: string | null | undefined
  editModel: string | null | undefined
  videoModel: string | null | undefined
  audioModel: string | null | undefined
  capabilityOverrides: CapabilitySelections
  videoRatio: string | null | undefined
  ttsRate: string | null | undefined
  onUpdateConfig: (key: string, value: unknown) => Promise<void>
  globalAssetText: string
  projectName: string
  episodes: EpisodeSummary[]
  currentEpisodeId?: string
  onEpisodeSelect?: (episodeId: string) => void
  onEpisodeCreate?: () => void
  onEpisodeRename?: (episodeId: string, newName: string) => void
  onEpisodeDelete?: (episodeId: string) => void
  capsuleNavItems: CapsuleNavItem[]
  currentStage: string
  onStageChange: (stage: string) => void
  projectId: string
  episodeId?: string
  onOpenAssetLibrary: () => void
  onOpenSettingsModal: () => void
  onRefresh: () => void
  assetLibraryLabel: string
  settingsLabel: string
  refreshTitle: string
}

const WORKBENCH_GROUPS = [
  {
    titleKey: 'script',
    items: [
      { labelKey: 'scriptParse', stage: 'config', path: 'script' },
      { labelKey: 'scriptReview', stage: 'config', path: 'workbench/script-review' },
    ],
  },
  {
    titleKey: 'assets',
    items: [
      { labelKey: 'characterAssets', stage: 'script', path: 'workbench/assets/characters' },
      { labelKey: 'itemAssets', stage: 'script', path: 'workbench/assets/items' },
      { labelKey: 'environmentAssets', stage: 'script', path: 'workbench/assets/environments' },
      { labelKey: 'timbreMatch', stage: 'voice', path: 'workbench/assets/timbre' },
    ],
  },
  {
    titleKey: 'storyboard',
    items: [
      { labelKey: 'storyboardDesign', stage: 'storyboard', path: 'workbench/storyboard' },
    ],
  },
  {
    titleKey: 'production',
    items: [
      { labelKey: 'productionEpisodes', stage: 'videos', path: 'workbench/production/episodes' },
      { labelKey: 'shotProduction', stage: 'videos', path: 'workbench/production/shot' },
      { labelKey: 'exportDelivery', stage: 'editor', path: 'workbench/production/export' },
    ],
  },
]

function WorkbenchSidebar({
  projectName,
  episodes,
  currentEpisodeId,
  onEpisodeSelect,
  onEpisodeCreate,
  capsuleNavItems,
  currentStage,
  onStageChange,
  projectId,
}: Pick<WorkspaceHeaderShellProps,
  | 'projectName'
  | 'episodes'
  | 'currentEpisodeId'
  | 'onEpisodeSelect'
  | 'onEpisodeCreate'
  | 'capsuleNavItems'
  | 'currentStage'
  | 'onStageChange'
  | 'projectId'
>) {
  const t = useTranslations('novelPromotion.workbenchShell')
  const currentEpisode = episodes.find((episode) => episode.id === currentEpisodeId)
  const statusLabels: Record<'empty' | 'active' | 'processing' | 'ready', string> = {
    empty: t('status.empty'),
    active: t('status.active'),
    processing: t('status.processing'),
    ready: t('status.ready'),
  }
  const buildWorkbenchHref = (path: string) => {
    const episodeQuery = currentEpisodeId ? `?episode=${encodeURIComponent(currentEpisodeId)}` : ''
    return `/workspace/${projectId}/${path}${episodeQuery}`
  }
  const metricPriority = [
    'episodes',
    'clips',
    'characters',
    'storyboards',
    'panels',
    'videos',
    'voiceLines',
    'editorProjects',
    'missingVideos',
  ]
  const summarizeCounts = (counts?: Record<string, number>) => {
    if (!counts) return []
    return metricPriority
      .filter((key) => typeof counts[key] === 'number')
      .slice(0, 2)
      .map((key) => t(`metrics.${key}`, { count: counts[key] }))
  }

  return (
    <aside className="fixed left-6 top-20 bottom-6 z-30 hidden w-64 flex-col rounded-lg border border-white/10 bg-[#15161b] p-4 shadow-[0_18px_50px_rgba(0,0,0,.28)] xl:flex">
      <div className="border-b border-white/10 pb-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2c6ef2] text-sm font-bold text-white">
            N
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{projectName}</div>
            <div className="text-xs text-white/45">{t('projectWorkflow')}</div>
          </div>
        </div>
        <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
          <div className="text-[11px] text-white/42">{t('currentEpisode')}</div>
          <div className="mt-1 truncate text-sm font-medium text-white">
            {currentEpisode?.name || t('noEpisode')}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        {capsuleNavItems.map((item) => {
          const active = currentStage === item.id
          const disabled = item.disabled
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onStageChange(item.id)}
              className={`w-full rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
                disabled
                  ? 'cursor-not-allowed text-white/28'
                  : active
                    ? 'bg-[#2c6ef2] text-white shadow-[0_10px_24px_rgba(44,110,242,.22)]'
                    : 'text-white/68 hover:bg-white/7 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`h-1.5 w-1.5 rounded-full ${
                  item.status === 'processing'
                    ? 'animate-pulse bg-[#d6ff00]'
                    : item.status === 'ready'
                      ? 'bg-emerald-400'
                      : active
                        ? 'bg-white'
                        : 'bg-white/22'
                }`} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="text-[10px] text-current opacity-55">{statusLabels[item.status]}</span>
              </div>
              {typeof item.progress === 'number' ? (
                <div className="mt-2">
                  <div className="h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${item.status === 'ready' ? 'bg-emerald-400' : 'bg-[#2c6ef2]'}`}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-current opacity-45">
                    <span>{t('progress', { value: item.progress })}</span>
                    <span className="truncate">{summarizeCounts(item.counts).join(' · ')}</span>
                  </div>
                </div>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto border-t border-white/10 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold text-white/48">{t('episodeList')}</div>
          {onEpisodeCreate ? (
            <button
              type="button"
              onClick={onEpisodeCreate}
              className="rounded p-1 text-white/45 transition-colors hover:bg-white/7 hover:text-white"
              title={t('addEpisode')}
            >
              <AppIcon name="plus" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="space-y-1">
          {episodes.map((episode) => {
            const active = episode.id === currentEpisodeId
            return (
              <button
                key={episode.id}
                type="button"
                onClick={() => onEpisodeSelect?.(episode.id)}
                className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
                  active ? 'bg-white/10 text-white' : 'text-white/54 hover:bg-white/7 hover:text-white'
                }`}
              >
                <div className="truncate text-sm font-medium">{episode.name}</div>
                {episode.description ? (
                  <div className="mt-0.5 line-clamp-1 text-xs opacity-55">{episode.description}</div>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-4 border-t border-white/10 pt-4">
        {WORKBENCH_GROUPS.map((group) => (
          <div key={group.titleKey} className="mb-3 last:mb-0">
            <div className="mb-1 px-2 text-[11px] font-semibold text-white/38">
              {t(`groups.${group.titleKey}`)}
            </div>
            {group.items.map((item) => {
              const active = currentStage === item.stage
              return (
                <Link
                  key={`${group.titleKey}-${item.labelKey}`}
                  href={buildWorkbenchHref(item.path)}
                  className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                    active ? 'text-white' : 'text-white/45 hover:bg-white/7 hover:text-white/82'
                  }`}
                >
                  {t(`items.${item.labelKey}`)}
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )
}

export default function WorkspaceHeaderShell({
  isSettingsModalOpen,
  isWorldContextModalOpen,
  onCloseSettingsModal,
  onCloseWorldContextModal,
  availableModels,
  modelsLoaded,
  artStyle,
  analysisModel,
  characterModel,
  locationModel,
  storyboardModel,
  editModel,
  videoModel,
  audioModel,
  capabilityOverrides,
  videoRatio,
  ttsRate,
  onUpdateConfig,
  globalAssetText,
  projectName,
  episodes,
  currentEpisodeId,
  onEpisodeSelect,
  onEpisodeCreate,
  onEpisodeRename,
  onEpisodeDelete,
  capsuleNavItems,
  currentStage,
  onStageChange,
  projectId,
  episodeId,
  onOpenAssetLibrary,
  onOpenSettingsModal,
  onRefresh,
  assetLibraryLabel,
  settingsLabel,
  refreshTitle,
}: WorkspaceHeaderShellProps) {
  return (
    <>
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={onCloseSettingsModal}
        availableModels={availableModels}
        modelsLoaded={modelsLoaded}
        artStyle={artStyle ?? undefined}
        analysisModel={analysisModel ?? undefined}
        characterModel={characterModel ?? undefined}
        locationModel={locationModel ?? undefined}
        imageModel={storyboardModel ?? undefined}
        editModel={editModel ?? undefined}
        videoModel={videoModel ?? undefined}
        audioModel={audioModel ?? undefined}
        videoRatio={videoRatio ?? undefined}
        capabilityOverrides={capabilityOverrides}
        ttsRate={ttsRate ?? undefined}
        onArtStyleChange={(value) => { onUpdateConfig('artStyle', value) }}
        onAnalysisModelChange={(value) => { onUpdateConfig('analysisModel', value) }}
        onCharacterModelChange={(value) => { onUpdateConfig('characterModel', value) }}
        onLocationModelChange={(value) => { onUpdateConfig('locationModel', value) }}
        onImageModelChange={(value) => { onUpdateConfig('storyboardModel', value) }}
        onEditModelChange={(value) => { onUpdateConfig('editModel', value) }}
        onVideoModelChange={(value) => { onUpdateConfig('videoModel', value) }}
        onAudioModelChange={(value) => { onUpdateConfig('audioModel', value) }}
        onVideoRatioChange={(value) => { onUpdateConfig('videoRatio', value) }}
        onCapabilityOverridesChange={(value) => { onUpdateConfig('capabilityOverrides', value) }}
        onTTSRateChange={(value) => { onUpdateConfig('ttsRate', value) }}
      />

      <WorldContextModal
        isOpen={isWorldContextModalOpen}
        onClose={onCloseWorldContextModal}
        text={globalAssetText}
        onChange={(value) => { onUpdateConfig('globalAssetText', value) }}
      />
      <WorkbenchSidebar
        projectName={projectName}
        episodes={episodes}
        currentEpisodeId={currentEpisodeId}
        onEpisodeSelect={onEpisodeSelect}
        onEpisodeCreate={onEpisodeCreate}
        capsuleNavItems={capsuleNavItems}
        currentStage={currentStage}
        onStageChange={onStageChange}
        projectId={projectId}
      />

      <div className="xl:hidden">
        {episodes.length > 0 && currentEpisodeId && (() => {
          const getNum = (name: string) => { const m = name.match(/\d+/); return m ? parseInt(m[0], 10) : Infinity }
          const sorted = [...episodes].sort((a, b) => {
            const d = getNum(a.name) - getNum(b.name)
            return d !== 0 ? d : a.name.localeCompare(b.name, 'zh')
          })
          return (
            <EpisodeSelector
              projectName={projectName}
              episodes={sorted.map((ep) => {
                const stageArtifacts = resolveEpisodeStageArtifacts({
                  novelText: null,
                  clips: ep.clips || [],
                  storyboards: ep.storyboards || [],
                  voiceLines: [],
                })
                return {
                  id: ep.id,
                  title: ep.name,
                  summary: ep.description ?? undefined,
                  status: {
                    script: stageArtifacts.hasScript ? 'ready' as const : 'empty' as const,
                    visual: stageArtifacts.hasVideo ? 'ready' as const : 'empty' as const,
                  },
                }
              })}
              currentId={currentEpisodeId}
              onSelect={(id) => onEpisodeSelect?.(id)}
              onAdd={onEpisodeCreate}
              onRename={(id, newName) => onEpisodeRename?.(id, newName)}
              onDelete={onEpisodeDelete}
            />
          )
        })()}
      </div>

      <div className="xl:hidden">
        <CapsuleNav
          items={capsuleNavItems}
          activeId={currentStage}
          onItemClick={onStageChange}
          projectId={projectId}
          episodeId={episodeId}
        />
      </div>

      <WorkspaceTopActions
        onOpenAssetLibrary={onOpenAssetLibrary}
        onOpenSettings={onOpenSettingsModal}
        onRefresh={onRefresh}
        assetLibraryLabel={assetLibraryLabel}
        settingsLabel={settingsLabel}
        refreshTitle={refreshTitle}
      />
    </>
  )
}
