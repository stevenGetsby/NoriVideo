'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { queryKeys } from '@/lib/query/keys'
import { useWorkflowState, type WorkflowStageState } from '@/lib/query/hooks/useProjectData'
import type { Episode } from '../types'
import type {
  Character,
  Location,
  NovelPromotionPanel,
  NovelPromotionProject,
  NovelPromotionStoryboard,
  Prop,
} from '@/types/project'

const FOCUS_META: Record<string, { icon: AppIconName; tone: string }> = {
  'script': { icon: 'fileText', tone: 'text-[#8ab8ff]' },
  'script-review': { icon: 'clipboardCheck', tone: 'text-[#8ab8ff]' },
  'characters': { icon: 'usersRound', tone: 'text-[#7ee7c8]' },
  'items': { icon: 'package', tone: 'text-[#f8c96a]' },
  'environments': { icon: 'image', tone: 'text-[#9dd7ff]' },
  'timbre': { icon: 'audioWave', tone: 'text-[#d7a5ff]' },
  'storyboard': { icon: 'clapperboard', tone: 'text-[#8ab8ff]' },
  'episodes': { icon: 'bookOpen', tone: 'text-[#7ee7c8]' },
  'timeline': { icon: 'barChart', tone: 'text-[#f8c96a]' },
  'shot': { icon: 'film', tone: 'text-[#8ab8ff]' },
  'shot-detail': { icon: 'video', tone: 'text-[#9dd7ff]' },
  'export': { icon: 'download', tone: 'text-[#7ee7c8]' },
  'workbench': { icon: 'monitor', tone: 'text-[#8ab8ff]' },
}

const WORKFLOW_STAGE_PATHS: Record<WorkflowStageState['id'], string> = {
  config: 'workbench/script-review',
  script: 'workbench/assets/characters',
  storyboard: 'workbench/storyboard',
  videos: 'workbench/production/timeline',
  voice: 'workbench/assets/timbre',
  editor: 'workbench/production/export',
}

interface WorkbenchFocusPanelProps {
  projectId: string
  currentStage: string
  projectData?: NovelPromotionProject | null
  episode?: Episode | null
  episodes?: Episode[]
}

type TimelineDraft = {
  duration: string
  shotType: string
  cameraMove: string
}

type StageReviewState = 'confirmed' | 'review'

type TimelineSummaryPanelRow = {
  id: string
  timelineIndex: number
  panelIndex: number
  startSeconds: number
  endSeconds: number
  durationSeconds: number
  durationSource: 'panel' | 'default'
  status: 'ready' | 'needs_refs' | 'needs_image' | 'needs_video' | 'needs_duration'
  readiness: {
    hasRefs: boolean
    hasImage: boolean
    hasVideo: boolean
    hasDuration: boolean
  }
}

type TimelineSummaryEpisode = {
  id: string
  stats: {
    panels: number
    images: number
    videos: number
    readyShots: number
    missingRefs: number
    missingImages: number
    missingVideos: number
    missingDurations: number
    scheduledDurationSeconds: number
    averageDurationSeconds: number
  }
  queues: {
    refs: string[]
    images: string[]
    videos: string[]
    durations: string[]
  }
  timeline: TimelineSummaryPanelRow[]
}

type TimelineSummaryResponse = {
  success?: boolean
  schema?: string
  episodes?: TimelineSummaryEpisode[]
}

function flattenPanels(episode?: Episode | null): NovelPromotionPanel[] {
  return (episode?.storyboards || []).flatMap((storyboard) => storyboard.panels || [])
}

function countReadyImages(items: Array<{ images?: Array<{ imageUrl?: string | null }> }>) {
  return items.reduce((count, item) => count + (item.images?.some((image) => Boolean(image.imageUrl)) ? 1 : 0), 0)
}

function getCharacterReadyCount(characters: Character[]) {
  return characters.reduce((count, character) => (
    count + (character.appearances?.some((appearance) => Boolean(appearance.imageUrl)) ? 1 : 0)
  ), 0)
}

function pickPanelTitle(panel: NovelPromotionPanel, index: number) {
  return cleanDisplayText(panel.description || panel.srtSegment || panel.videoPrompt) || `#${index + 1}`
}

const INTERNAL_CREATION_MARKER = /(\bNORI_AGENT[\w-]*\b|\bsuper[_\s-]?agent\b|\bagent\b|自动创作模式)/i

function cleanDisplayText(value?: string | null) {
  const text = (value || '').trim()
  if (!text) return ''
  if (/\bNORI_AGENT[\w-]*\b/i.test(text) || /\bsuper[_\s-]?agent\b/i.test(text) || /自动创作模式/i.test(text)) {
    return ''
  }
  if (/^\s*[\[{]/.test(text) && INTERNAL_CREATION_MARKER.test(text)) {
    return ''
  }
  return text
    .replace(/\[[^\]]*(?:agent|NORI_AGENT|super[_\s-]?agent|自动创作模式)[^\]]*\]/gi, '')
    .replace(/【[^】]*(?:agent|NORI_AGENT|super[_\s-]?agent|自动创作模式)[^】]*】/gi, '')
    .replace(/\{[^{}]*(?:agent|NORI_AGENT|super[_\s-]?agent|自动创作模式)[^{}]*\}/gi, '')
    .replace(/\bNORI_AGENT[\w-]*\b/gi, '')
    .replace(/\bsuper[_\s-]?agent\b/gi, '')
    .replace(/\bagent\b/gi, '')
    .replace(/自动创作模式/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function displayText(value: string | null | undefined, fallback: string) {
  return cleanDisplayText(value) || fallback
}

function firstAssetImage(item?: { images?: Array<{ imageUrl?: string | null }> }) {
  return item?.images?.find((image) => Boolean(image.imageUrl))?.imageUrl || null
}

function firstCharacterImage(character?: Character) {
  return character?.appearances?.find((appearance) => Boolean(appearance.imageUrl))?.imageUrl || null
}

function countPanelAssetRefs(panels: NovelPromotionPanel[]) {
  return panels.reduce((count, panel) => (
    count + (panel.characters ? 1 : 0) + (panel.location ? 1 : 0) + (panel.props ? 1 : 0)
  ), 0)
}

function hasPanelVideo(panel: NovelPromotionPanel) {
  return Boolean(panel.videoUrl || panel.lipSyncVideoUrl)
}

function hasPanelRefs(panel: NovelPromotionPanel) {
  return Boolean(panel.characters || panel.location || panel.props)
}

function includesText(source: string | null | undefined, target: string) {
  return Boolean(source && target && source.toLowerCase().includes(target.toLowerCase()))
}

function formatSeconds(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Number(value.toFixed(1))}s` : '-'
}

function countTextChars(value?: string | null) {
  return (value || '').replace(/\s/g, '').length
}

export default function WorkbenchFocusPanel({
  projectId,
  currentStage,
  projectData,
  episode,
  episodes = [],
}: WorkbenchFocusPanelProps) {
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const t = useTranslations('novelPromotion.workbenchFocus')
  const rawFocus = searchParams?.get('focus')
  const shouldRender = Boolean(rawFocus && FOCUS_META[rawFocus])
  const focus = shouldRender ? rawFocus as string : 'workbench'
  const [draftName, setDraftName] = useState('')
  const [draftSummary, setDraftSummary] = useState('')
  const [draftImagePrompt, setDraftImagePrompt] = useState('')
  const [draftVideoPrompt, setDraftVideoPrompt] = useState('')
  const [draftDuration, setDraftDuration] = useState('')
  const [draftShotDescription, setDraftShotDescription] = useState('')
  const [draftShotType, setDraftShotType] = useState('')
  const [draftCameraMove, setDraftCameraMove] = useState('')
  const [draftShotLocation, setDraftShotLocation] = useState('')
  const [draftShotCharacters, setDraftShotCharacters] = useState('')
  const [draftShotProps, setDraftShotProps] = useState('')
  const [timelineDrafts, setTimelineDrafts] = useState<Record<string, TimelineDraft>>({})
  const [stageReviewStates, setStageReviewStates] = useState<Record<string, StageReviewState>>({})
  const [timelineSummary, setTimelineSummary] = useState<TimelineSummaryResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const workflowStateQuery = useWorkflowState(projectId, episode?.id)
  const stageReviewEndpoint = `/api/projects/${projectId}/workflow-stage-review${episode?.id ? `?episodeId=${encodeURIComponent(episode.id)}` : ''}`
  const loadTimelineSummary = useCallback(async (signal?: AbortSignal) => {
    if (!episode?.id) {
      setTimelineSummary(null)
      return
    }
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/timeline?episodeId=${encodeURIComponent(episode.id)}`)
      if (signal?.aborted) return
      if (!response.ok) throw new Error('load timeline summary failed')
      const data = await response.json() as TimelineSummaryResponse
      if (!signal?.aborted) setTimelineSummary(data)
    } catch {
      if (!signal?.aborted) setTimelineSummary(null)
    }
  }, [episode?.id, projectId])

  const meta = FOCUS_META[focus]
  const variant = searchParams?.get('workbench') === 'premium2' ? 'premium2' : 'standard'
  const stageLabel = t(`stages.${currentStage}`)
  const characters = projectData?.characters || []
  const locations = projectData?.locations || []
  const props = projectData?.props || []
  const clips = episode?.clips || []
  const storyboards = episode?.storyboards || []
  const panels = flattenPanels(episode)
  const videoPanels = panels.filter((panel) => Boolean(panel.videoUrl || panel.lipSyncVideoUrl))
  const imagePanels = panels.filter((panel) => Boolean(panel.imageUrl))
  const pendingImagePanels = panels.filter((panel) => !panel.imageUrl)
  const pendingVideoPanels = panels.filter((panel) => panel.imageUrl && !hasPanelVideo(panel))
  const deliverablePanels = panels.filter((panel) => panel.imageUrl && hasPanelVideo(panel))
  const attentionPanels = panels.filter((panel) => (
    Boolean(panel.imageErrorMessage || panel.videoErrorMessage) || !hasPanelRefs(panel)
  ))
  const runningPanels = panels.filter((panel) => panel.imageTaskRunning || panel.videoTaskRunning)
  const imageErrorCount = panels.filter((panel) => Boolean(panel.imageErrorMessage)).length
  const videoErrorCount = panels.filter((panel) => Boolean(panel.videoErrorMessage)).length
  const panelCompletion = panels.length ? Math.round((videoPanels.length / panels.length) * 100) : 0
  const timelineEpisodeSummary = timelineSummary?.episodes?.find((item) => item.id === episode?.id) || timelineSummary?.episodes?.[0] || null
  const panelById = new Map(panels.map((panel) => [panel.id, panel]))
  const timelinePanelRows = timelineEpisodeSummary?.timeline
    ?.map((row) => {
      const panel = panelById.get(row.id)
      return panel ? { row, panel } : null
    })
    .filter((item): item is { row: TimelineSummaryPanelRow; panel: NovelPromotionPanel } => Boolean(item))
    || panels.map((panel, index) => ({
      panel,
      row: {
        id: panel.id,
        timelineIndex: index + 1,
        panelIndex: panel.panelIndex,
        startSeconds: 0,
        endSeconds: Number(panel.duration) || 0,
        durationSeconds: Number(panel.duration) || 0,
        durationSource: (panel.duration ? 'panel' : 'default') as 'panel' | 'default',
        status: (panel.imageUrl && hasPanelVideo(panel) && hasPanelRefs(panel) && panel.duration ? 'ready' : 'needs_video') as TimelineSummaryPanelRow['status'],
        readiness: {
          hasRefs: hasPanelRefs(panel),
          hasImage: Boolean(panel.imageUrl),
          hasVideo: hasPanelVideo(panel),
          hasDuration: typeof panel.duration === 'number' && Number.isFinite(panel.duration) && panel.duration > 0,
        },
      },
    }))
  const timelineOrderedPanels = timelinePanelRows.map((item) => item.panel)
  const timelineStats = timelineEpisodeSummary?.stats
  const totalDuration = timelineStats?.scheduledDurationSeconds ?? panels.reduce((sum, panel) => sum + (Number(panel.duration) || 0), 0)
  const averageDuration = timelineStats?.averageDurationSeconds ?? (panels.length ? totalDuration / panels.length : 0)
  const timelineMissingRefs = timelineEpisodeSummary
    ? timelineEpisodeSummary.queues.refs.map((id) => panelById.get(id)).filter((panel): panel is NovelPromotionPanel => Boolean(panel))
    : panels.filter((panel) => !hasPanelRefs(panel))
  const timelineMissingDuration = timelineEpisodeSummary
    ? timelineEpisodeSummary.queues.durations.map((id) => panelById.get(id)).filter((panel): panel is NovelPromotionPanel => Boolean(panel))
    : panels.filter((panel) => !(typeof panel.duration === 'number' && Number.isFinite(panel.duration) && panel.duration > 0))
  const timelineReadyPanels = timelineEpisodeSummary
    ? timelinePanelRows.filter((item) => item.row.status === 'ready').map((item) => item.panel)
    : panels.filter((panel) => panel.imageUrl && hasPanelVideo(panel) && hasPanelRefs(panel))
  const voiceLinesCount = Array.isArray(episode?.voiceLines) ? episode.voiceLines.length : 0
  const missingVideoCount = Math.max(panels.length - videoPanels.length, 0)
  const missingImageCount = Math.max(panels.length - imagePanels.length, 0)
  const storyboardExpectedPanels = storyboards.reduce((sum, storyboard) => (
    sum + Math.max(storyboard.panelCount || 0, storyboard.panels?.length || 0)
  ), 0)
  const storyboardsNeedingPanels = storyboards.filter((storyboard) => {
    const itemPanels = storyboard.panels || []
    return itemPanels.length < Math.max(storyboard.panelCount || 0, 1)
  })
  const storyboardsNeedingRefs = storyboards.filter((storyboard) => (
    (storyboard.panels || []).some((panel) => !hasPanelRefs(panel))
  ))
  const storyboardsNeedingImages = storyboards.filter((storyboard) => (
    (storyboard.panels || []).some((panel) => !panel.imageUrl)
  ))
  const storyboardsWithVideoReady = storyboards.filter((storyboard) => {
    const itemPanels = storyboard.panels || []
    return itemPanels.length > 0 && itemPanels.every((panel) => hasPanelVideo(panel))
  })
  const scriptText = episode?.novelText || projectData?.novelText || ''
  const srtText = episode?.srtContent || projectData?.srtContent || ''
  const displayScriptText = cleanDisplayText(scriptText)
  const displaySrtText = cleanDisplayText(srtText)
  const timelineDraftSignature = panels
    .map((panel) => `${panel.id}:${panel.duration ?? ''}:${panel.shotType ?? ''}:${panel.cameraMove ?? ''}`)
    .join('|')
  const selectedCharacterId = searchParams?.get('characterId')
  const selectedItemId = searchParams?.get('itemId') || searchParams?.get('assetId')
  const selectedEnvironmentId = searchParams?.get('environmentId') || searchParams?.get('locationId')
  const selectedProp = props.find((prop) => prop.id === selectedItemId) || props[0]
  const selectedLocation = locations.find((location) => location.id === selectedEnvironmentId) || locations[0]
  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) || characters[0]
  const selectedPanel = focus === 'shot-detail'
    ? panels.find((panel) => panel.id === searchParams?.get('shotId')) || panels[0]
    : panels[0]
  const selectedPanelIndex = selectedPanel ? panels.findIndex((panel) => panel.id === selectedPanel.id) : -1
  const selectedPanelHasImage = Boolean(selectedPanel?.imageUrl)
  const selectedPanelHasVideo = Boolean(selectedPanel && hasPanelVideo(selectedPanel))
  const selectedPanelHasRefs = Boolean(selectedPanel && hasPanelRefs(selectedPanel))
  const selectedPanelHasPrompts = Boolean(selectedPanel?.imagePrompt || selectedPanel?.videoPrompt || selectedPanel?.firstLastFramePrompt)
  const selectedPanelHasDuration = typeof selectedPanel?.duration === 'number' && Number.isFinite(selectedPanel.duration)
  const selectedPanelHasErrors = Boolean(selectedPanel?.imageErrorMessage || selectedPanel?.videoErrorMessage)
  const selectedPanelRunning = Boolean(selectedPanel?.imageTaskRunning || selectedPanel?.videoTaskRunning)
  const selectedAsset = focus === 'items'
    ? selectedProp
    : focus === 'environments'
      ? selectedLocation
      : null
  const selectedAssetId = focus === 'characters'
    ? selectedCharacter?.id
    : focus === 'items'
      ? selectedProp?.id
      : focus === 'environments'
        ? selectedLocation?.id
        : null
  const buildShotDetailHref = (panelId: string) => {
    const episodeQuery = episode?.id ? `?episode=${encodeURIComponent(episode.id)}` : ''
    return `/workspace/${projectId}/workbench/production/shot/${panelId}${episodeQuery}`
  }
  const buildEpisodeTimelineHref = (episodeId: string) => (
    `/workspace/${projectId}/workbench/production/timeline?episode=${encodeURIComponent(episodeId)}`
  )
  const buildStoryboardHref = () => {
    const episodeQuery = episode?.id ? `?episode=${encodeURIComponent(episode.id)}` : ''
    return `/workspace/${projectId}/workbench/storyboard${episodeQuery}`
  }
  const buildShotQueueHref = () => {
    const episodeQuery = episode?.id ? `?episode=${encodeURIComponent(episode.id)}` : ''
    return `/workspace/${projectId}/workbench/production/shot${episodeQuery}`
  }
  const buildStageHref = (stageId: WorkflowStageState['id']) => {
    const episodeQuery = episode?.id ? `?episode=${encodeURIComponent(episode.id)}` : ''
    return `/workspace/${projectId}/${WORKFLOW_STAGE_PATHS[stageId]}${episodeQuery}`
  }
  const buildAssetFocusHref = (targetFocus: 'characters' | 'items' | 'environments', assetId: string) => {
    const params = new URLSearchParams()
    params.set('stage', currentStage)
    params.set('focus', targetFocus)
    if (episode?.id) params.set('episode', episode.id)
    if (targetFocus === 'characters') params.set('characterId', assetId)
    if (targetFocus === 'items') params.set('itemId', assetId)
    if (targetFocus === 'environments') params.set('environmentId', assetId)
    return `/workspace/${projectId}?${params.toString()}`
  }
  const assetFocusKind = focus === 'characters' || focus === 'items' || focus === 'environments' ? focus : null
  const assetFocusItems = assetFocusKind === 'characters'
    ? characters.map((character) => ({
      id: character.id,
      title: displayText(character.name, t('data.empty')),
      description: cleanDisplayText(character.introduction || character.aliases?.join(', ')),
      imageReady: character.appearances?.some((appearance) => Boolean(appearance.imageUrl)) || false,
      imageCount: character.appearances?.filter((appearance) => Boolean(appearance.imageUrl)).length || 0,
      scriptRefs: clips.filter((clip) => includesText(clip.characters, character.name)).length,
      panelRefs: panels.filter((panel) => includesText(panel.characters, character.name)).length,
      href: buildAssetFocusHref('characters', character.id),
    }))
    : assetFocusKind === 'items'
      ? props.map((item) => ({
        id: item.id,
        title: displayText(item.name, t('data.empty')),
        description: cleanDisplayText(item.summary),
        imageReady: item.images?.some((image) => Boolean(image.imageUrl)) || false,
        imageCount: item.images?.filter((image) => Boolean(image.imageUrl)).length || 0,
        scriptRefs: clips.filter((clip) => includesText(clip.props, item.name)).length,
        panelRefs: panels.filter((panel) => includesText(panel.props, item.name)).length,
        href: buildAssetFocusHref('items', item.id),
      }))
      : assetFocusKind === 'environments'
        ? locations.map((location) => ({
          id: location.id,
          title: displayText(location.name, t('data.empty')),
          description: cleanDisplayText(location.summary),
          imageReady: location.images?.some((image) => Boolean(image.imageUrl)) || false,
          imageCount: location.images?.filter((image) => Boolean(image.imageUrl)).length || 0,
          scriptRefs: clips.filter((clip) => includesText(clip.location, location.name)).length,
          panelRefs: panels.filter((panel) => includesText(panel.location, location.name)).length,
          href: buildAssetFocusHref('environments', location.id),
        }))
        : []
  const assetImageReadyItems = assetFocusItems.filter((item) => item.imageReady)
  const assetMissingImageItems = assetFocusItems.filter((item) => !item.imageReady)
  const assetLinkedPanelItems = assetFocusItems.filter((item) => item.panelRefs > 0)
  const assetScriptOnlyItems = assetFocusItems.filter((item) => item.scriptRefs > 0 && item.panelRefs === 0)
  const workflowStages = workflowStateQuery.data?.stages || []
  const statusLabels: Record<WorkflowStageState['status'], string> = {
    empty: t('workflow.status.empty'),
    active: t('workflow.status.active'),
    processing: t('workflow.status.processing'),
    ready: t('workflow.status.ready'),
  }
  const metricPriority = [
    'episodes',
    'clips',
    'characters',
    'assets',
    'storyboards',
    'panels',
    'videos',
    'missingVideos',
    'voiceLines',
    'editorProjects',
  ]
  const summarizeWorkflowCounts = (counts: Record<string, number>) => (
    metricPriority
      .filter((key) => typeof counts[key] === 'number')
      .slice(0, 3)
      .map((key) => t(`workflow.metrics.${key}`, { count: counts[key] }))
  )

  useEffect(() => {
    if (focus === 'characters') {
      setDraftName(cleanDisplayText(selectedCharacter?.name))
      setDraftSummary(cleanDisplayText(selectedCharacter?.introduction))
      return
    }
    setDraftName(cleanDisplayText(selectedAsset?.name))
    setDraftSummary(cleanDisplayText(selectedAsset?.summary))
  }, [focus, selectedAsset?.id, selectedAsset?.name, selectedAsset?.summary, selectedCharacter?.id, selectedCharacter?.name, selectedCharacter?.introduction])

  useEffect(() => {
    setDraftImagePrompt(cleanDisplayText(selectedPanel?.imagePrompt || selectedPanel?.description))
    setDraftVideoPrompt(cleanDisplayText(selectedPanel?.videoPrompt || selectedPanel?.firstLastFramePrompt))
    setDraftDuration(selectedPanel?.duration ? String(selectedPanel.duration) : '')
    setDraftShotDescription(cleanDisplayText(selectedPanel?.description))
    setDraftShotType(cleanDisplayText(selectedPanel?.shotType))
    setDraftCameraMove(cleanDisplayText(selectedPanel?.cameraMove))
    setDraftShotLocation(cleanDisplayText(selectedPanel?.location))
    setDraftShotCharacters(cleanDisplayText(selectedPanel?.characters))
    setDraftShotProps(cleanDisplayText(selectedPanel?.props))
  }, [
    selectedPanel?.id,
    selectedPanel?.imagePrompt,
    selectedPanel?.description,
    selectedPanel?.videoPrompt,
    selectedPanel?.firstLastFramePrompt,
    selectedPanel?.duration,
    selectedPanel?.shotType,
    selectedPanel?.cameraMove,
    selectedPanel?.location,
    selectedPanel?.characters,
    selectedPanel?.props,
  ])

  useEffect(() => {
    if (focus !== 'timeline') return
    setTimelineDrafts(Object.fromEntries(
      panels.map((panel) => [
        panel.id,
        {
          duration: panel.duration ? String(panel.duration) : '',
          shotType: cleanDisplayText(panel.shotType),
          cameraMove: cleanDisplayText(panel.cameraMove),
        },
      ]),
    ))
  }, [focus, timelineDraftSignature])

  useEffect(() => {
    let cancelled = false
    async function loadStageReviewStates() {
      try {
        const response = await apiFetch(stageReviewEndpoint)
        if (!response.ok) throw new Error('load workflow stage review failed')
        const data = await response.json() as { states?: Record<string, StageReviewState> }
        if (!cancelled) setStageReviewStates(data.states || {})
      } catch {
        if (!cancelled) setStageReviewStates({})
      }
    }
    void loadStageReviewStates()
    return () => {
      cancelled = true
    }
  }, [stageReviewEndpoint])

  useEffect(() => {
    if (focus !== 'timeline') {
      setTimelineSummary(null)
      return
    }
    const controller = new AbortController()
    void loadTimelineSummary(controller.signal)
    return () => {
      controller.abort()
    }
  }, [focus, loadTimelineSummary])

  const persistStageReviewStates = async (next: Record<string, StageReviewState>) => {
    try {
      const response = await apiFetch(stageReviewEndpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ states: next }),
      })
      if (!response.ok) throw new Error('save workflow stage review failed')
      const data = await response.json() as { states?: Record<string, StageReviewState> }
      if (data.states) setStageReviewStates(data.states)
      await queryClient.invalidateQueries({ queryKey: queryKeys.workflowState(projectId, episode?.id || null) })
    } catch {
      setSaveMessage(t('edit.saveFailed'))
    }
  }

  const updateStageReviewState = (stageId: string, state: StageReviewState) => {
    setStageReviewStates((current) => {
      const next = { ...current, [stageId]: state }
      void persistStageReviewStates(next)
      return next
    })
  }

  const refreshAfterSave = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    if (episode?.id) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episode.id) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episode.id) })
    }
  }

  const saveAssetDraft = async () => {
    if (!selectedAsset && focus !== 'characters') return
    setSaving(true)
    setSaveMessage(null)
    try {
      const response = focus === 'characters'
        ? await apiFetch(`/api/novel-promotion/${projectId}/character`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characterId: selectedCharacter?.id,
            name: draftName,
            introduction: draftSummary,
          }),
        })
        : await apiFetch(`/api/novel-promotion/${projectId}/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(focus === 'items' ? { propId: selectedAsset?.id } : { locationId: selectedAsset?.id }),
            name: draftName,
            summary: draftSummary,
          }),
        })
      if (!response.ok) throw new Error(t('edit.saveFailed'))
      await refreshAfterSave()
      setSaveMessage(t('edit.saved'))
    } catch {
      setSaveMessage(t('edit.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const savePanelDraft = async () => {
    if (!selectedPanel) return
    const trimmedDuration = draftDuration.trim()
    const normalizedDuration = trimmedDuration === '' ? null : Number(trimmedDuration)
    if (normalizedDuration !== null && (!Number.isFinite(normalizedDuration) || normalizedDuration < 0)) {
      setSaveMessage(t('edit.saveFailed'))
      return
    }
    setSaving(true)
    setSaveMessage(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/panel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          panelId: selectedPanel.id,
          duration: normalizedDuration,
          description: draftShotDescription,
          shotType: draftShotType,
          cameraMove: draftCameraMove,
          location: draftShotLocation,
          characters: draftShotCharacters,
          props: draftShotProps,
          videoPrompt: draftVideoPrompt,
          firstLastFramePrompt: draftImagePrompt,
        }),
      })
      if (!response.ok) throw new Error(t('edit.saveFailed'))
      await refreshAfterSave()
      setSaveMessage(t('edit.saved'))
    } catch {
      setSaveMessage(t('edit.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const updateTimelineDraft = (panelId: string, patch: Partial<TimelineDraft>) => {
    setTimelineDrafts((current) => ({
      ...current,
      [panelId]: {
        duration: current[panelId]?.duration || '',
        shotType: current[panelId]?.shotType || '',
        cameraMove: current[panelId]?.cameraMove || '',
        ...patch,
      },
    }))
  }

  const saveTimelineDrafts = async () => {
    const changedPanels = panels.filter((panel) => {
      const draft = timelineDrafts[panel.id]
      if (!draft) return false
      return (
        draft.duration.trim() !== (panel.duration ? String(panel.duration) : '')
        || draft.shotType !== (panel.shotType || '')
        || draft.cameraMove !== (panel.cameraMove || '')
      )
    })

    if (changedPanels.length === 0) {
      setSaveMessage(t('timeline.noChanges'))
      return
    }

    const payloads = changedPanels.map((panel) => {
      const draft = timelineDrafts[panel.id]
      const trimmedDuration = draft.duration.trim()
      const duration = trimmedDuration === '' ? null : Number(trimmedDuration)
      return {
        panelId: panel.id,
        duration,
        shotType: draft.shotType,
        cameraMove: draft.cameraMove,
      }
    })

    if (payloads.some((payload) => payload.duration !== null && (!Number.isFinite(payload.duration) || payload.duration < 0))) {
      setSaveMessage(t('edit.saveFailed'))
      return
    }

    setSaving(true)
    setSaveMessage(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/timeline`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: episode?.id,
          updates: payloads,
        }),
      })
      if (!response.ok) throw new Error(t('edit.saveFailed'))
      await refreshAfterSave()
      await loadTimelineSummary()
      setSaveMessage(t('timeline.saved', { count: changedPanels.length }))
    } catch {
      setSaveMessage(t('edit.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const moveTimelinePanel = async (panelId: string, direction: 'up' | 'down') => {
    setSaving(true)
    setSaveMessage(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${projectId}/timeline`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: episode?.id,
          reorder: {
            panelId,
            direction,
          },
        }),
      })
      if (!response.ok) throw new Error(t('edit.saveFailed'))
      await refreshAfterSave()
      await loadTimelineSummary()
      setSaveMessage(t('timeline.reordered'))
    } catch {
      setSaveMessage(t('edit.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!shouldRender) return null

  const summaryCards = (() => {
    switch (focus) {
      case 'characters':
        return [
          { label: t('data.characters'), value: characters.length, hint: t('data.readyCount', { count: getCharacterReadyCount(characters) }) },
          { label: t('data.appearances'), value: characters.reduce((count, character) => count + (character.appearances?.length || 0), 0), hint: t('data.profile') },
          { label: t('data.voiceReady'), value: characters.filter((character) => Boolean(character.voiceId || character.customVoiceUrl)).length, hint: t('data.timbre') },
        ]
      case 'items':
        return [
          { label: t('data.items'), value: props.length, hint: t('data.readyCount', { count: countReadyImages(props) }) },
          { label: t('data.linkedPanels'), value: panels.filter((panel) => Boolean(panel.props)).length, hint: t('data.panelRefs') },
          { label: t('data.storyClips'), value: clips.filter((clip) => Boolean(clip.props)).length, hint: t('data.scriptRefs') },
        ]
      case 'environments':
        return [
          { label: t('data.environments'), value: locations.length, hint: t('data.readyCount', { count: countReadyImages(locations) }) },
          { label: t('data.linkedPanels'), value: panels.filter((panel) => Boolean(panel.location)).length, hint: t('data.panelRefs') },
          { label: t('data.storyClips'), value: clips.filter((clip) => Boolean(clip.location)).length, hint: t('data.scriptRefs') },
        ]
      case 'script':
      case 'script-review':
        return [
          { label: t('data.episodes'), value: episodes.length, hint: episode?.name || t('data.noEpisode') },
          { label: t('data.clips'), value: clips.length, hint: t('data.scriptUnits') },
          { label: t('data.storyboards'), value: storyboards.length, hint: t('data.nextStoryboard') },
        ]
      case 'storyboard':
        return [
          { label: t('data.storyboards'), value: storyboards.length, hint: t('data.currentEpisode') },
          { label: t('data.panels'), value: panels.length, hint: t('data.imageReadyCount', { count: imagePanels.length }) },
          { label: t('data.linkedPanels'), value: panels.filter((panel) => Boolean(panel.characters || panel.location || panel.props)).length, hint: t('data.assetRefs') },
        ]
      case 'episodes':
        return [
          { label: t('data.episodes'), value: episodes.length, hint: t('data.projectTotal') },
          { label: t('data.currentClips'), value: clips.length, hint: episode?.name || t('data.noEpisode') },
          { label: t('data.currentPanels'), value: panels.length, hint: t('data.currentEpisode') },
        ]
      case 'timeline':
        return [
          { label: t('data.panels'), value: timelineStats?.panels ?? panels.length, hint: t('data.currentEpisode') },
          { label: t('data.videoReady'), value: timelineStats?.videos ?? videoPanels.length, hint: `${panelCompletion}%` },
          { label: t('data.pending'), value: timelineStats?.missingVideos ?? Math.max(panels.length - videoPanels.length, 0), hint: t('data.needsGeneration') },
        ]
      case 'shot':
      case 'shot-detail':
      case 'export':
        return [
          { label: t('data.panels'), value: panels.length, hint: t('data.currentEpisode') },
          { label: t('data.videoReady'), value: videoPanels.length, hint: `${panelCompletion}%` },
          { label: t('data.pending'), value: Math.max(panels.length - videoPanels.length, 0), hint: t('data.needsGeneration') },
        ]
      case 'timbre':
        return [
          { label: t('data.characters'), value: characters.length, hint: t('data.roleVoices') },
          { label: t('data.voiceReady'), value: characters.filter((character) => Boolean(character.voiceId || character.customVoiceUrl)).length, hint: t('data.boundVoices') },
          { label: t('data.audioReady'), value: episode?.audioUrl ? 1 : 0, hint: t('data.episodeAudio') },
        ]
      default:
        return [
          { label: t('data.episodes'), value: episodes.length, hint: t('data.projectTotal') },
          { label: t('data.characters'), value: characters.length, hint: t('data.assets') },
          { label: t('data.panels'), value: panels.length, hint: t('data.currentEpisode') },
        ]
    }
  })()

  const detailItems = (() => {
    if (focus === 'characters') {
      return characters.slice(0, 6).map((character) => ({
        title: displayText(character.name, t('data.empty')),
        meta: t('data.appearanceCount', { count: character.appearances?.length || 0 }),
        detail: displayText(character.introduction || character.aliases?.join(', '), t('data.noDescription')),
      }))
    }
    if (focus === 'items') {
      return props.slice(0, 6).map((item: Prop) => ({
        title: displayText(item.name, t('data.empty')),
        meta: item.images?.some((image) => Boolean(image.imageUrl)) ? t('data.ready') : t('data.todo'),
        detail: displayText(item.summary, t('data.noDescription')),
      }))
    }
    if (focus === 'environments') {
      return locations.slice(0, 6).map((location: Location) => ({
        title: displayText(location.name, t('data.empty')),
        meta: location.images?.some((image) => Boolean(image.imageUrl)) ? t('data.ready') : t('data.todo'),
        detail: displayText(location.summary, t('data.noDescription')),
      }))
    }
    if (focus === 'script' || focus === 'script-review') {
      return clips.slice(0, 6).map((clip, index) => ({
        title: displayText(clip.summary, t('data.clipTitle', { index: index + 1 })),
        meta: displayText(clip.location, t('data.noLocation')),
        detail: displayText(clip.content || clip.characters, t('data.noDescription')),
      }))
    }
    if (focus === 'episodes') {
      return episodes.slice(0, 6).map((item) => ({
        title: displayText(item.name, t('data.empty')),
        meta: item.id === episode?.id ? t('data.current') : t('data.episodeNumber', { index: item.episodeNumber }),
        detail: displayText(item.description || item.novelText, t('data.noDescription')),
      }))
    }
    return panels.slice(0, 6).map((panel, index) => ({
      title: pickPanelTitle(panel, index),
      meta: panel.videoUrl || panel.lipSyncVideoUrl ? t('data.videoReady') : panel.imageUrl ? t('data.imageReady') : t('data.todo'),
      detail: displayText(panel.videoPrompt || panel.imagePrompt || panel.characters || panel.location, t('data.noDescription')),
    }))
  })()

  const assetSelectionItems = (() => {
    if (focus === 'characters') {
      return characters.map((character) => ({
        id: character.id,
        title: displayText(character.name, t('data.empty')),
        meta: t('data.appearanceCount', { count: character.appearances?.length || 0 }),
        detail: displayText(character.introduction || character.aliases?.join(', '), t('data.noDescription')),
        href: buildAssetFocusHref('characters', character.id),
      }))
    }
    if (focus === 'items') {
      return props.map((item) => ({
        id: item.id,
        title: displayText(item.name, t('data.empty')),
        meta: item.images?.some((image) => Boolean(image.imageUrl)) ? t('data.ready') : t('data.todo'),
        detail: displayText(item.summary, t('data.noDescription')),
        href: buildAssetFocusHref('items', item.id),
      }))
    }
    if (focus === 'environments') {
      return locations.map((location) => ({
        id: location.id,
        title: displayText(location.name, t('data.empty')),
        meta: location.images?.some((image) => Boolean(image.imageUrl)) ? t('data.ready') : t('data.todo'),
        detail: displayText(location.summary, t('data.noDescription')),
        href: buildAssetFocusHref('environments', location.id),
      }))
    }
    return []
  })()

  return (
    <section className="mb-5 rounded-lg border border-white/10 bg-[#151820] p-4 shadow-[0_18px_50px_rgba(0,0,0,.18)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5">
            <AppIcon name={meta.icon} className={`h-5 w-5 ${meta.tone}`} />
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-white">{t(`items.${focus}.title`)}</h2>
              <span className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/42">
                {t(`variants.${variant}`)}
              </span>
              <span className="rounded border border-[#2c6ef2]/35 bg-[#2c6ef2]/12 px-2 py-0.5 text-[11px] font-medium text-[#8ab8ff]">
                {stageLabel}
              </span>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-white/55">{t(`items.${focus}.description`)}</p>
          </div>
        </div>

        <div className="grid min-w-[220px] grid-cols-2 gap-2">
          <div className="rounded-md border border-white/10 bg-white/4 px-3 py-2">
            <div className="text-[11px] text-white/38">{t('labels.route')}</div>
            <div className="mt-1 truncate text-xs font-medium text-white/68">{t(`items.${focus}.route`)}</div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/4 px-3 py-2">
            <div className="text-[11px] text-white/38">{t('labels.status')}</div>
            <div className="mt-1 text-xs font-medium text-white/68">{t('labels.connected')}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {['primary', 'secondary', 'handoff'].map((slot) => (
          <div key={slot} className="rounded-md border border-white/10 bg-[#10131b] p-3">
            <div className="mb-1 text-xs font-semibold text-white/62">{t(`slots.${slot}`)}</div>
            <div className="text-sm leading-6 text-white/48">{t(`items.${focus}.slots.${slot}`)}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-md border border-white/10 bg-white/4 px-3 py-3">
            <div className="text-xs text-white/38">{card.label}</div>
            <div className="mt-1 text-xl font-semibold text-white">{card.value}</div>
            <div className="mt-1 truncate text-xs text-white/42">{card.hint}</div>
          </div>
        ))}
      </div>

      {focus === 'workbench' && (
        <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-white/72">{t('workflow.title')}</div>
              <div className="mt-1 text-xs text-white/38">{t('workflow.description')}</div>
            </div>
            <span className="w-fit rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/42">
              {workflowStateQuery.data?.source === 'derived' ? t('workflow.derived') : t('workflow.loading')}
            </span>
          </div>
          {workflowStages.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {workflowStages.map((stage) => {
                const reviewState = stageReviewStates[stage.id]
                return (
                  <Link
                    key={stage.id}
                    href={buildStageHref(stage.id)}
                    className="rounded-md border border-white/8 bg-white/4 p-3 transition-colors hover:border-[#2c6ef2]/55 hover:bg-white/7"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white/76">{t(`stages.${stage.id}`)}</div>
                        <div className="mt-1 truncate text-xs text-white/38">
                          {summarizeWorkflowCounts(stage.counts).join(' · ') || t('workflow.noMetrics')}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded px-2 py-1 text-[11px] font-medium ${
                        stage.status === 'ready'
                          ? 'bg-emerald-400/12 text-emerald-200'
                          : stage.status === 'active'
                            ? 'bg-[#2c6ef2]/14 text-[#9bc3ff]'
                            : stage.status === 'processing'
                              ? 'bg-[#d6ff00]/12 text-[#e7ff66]'
                              : 'bg-white/6 text-white/42'
                      }`}>
                        {statusLabels[stage.status]}
                      </span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div
                        className={`h-full rounded-full ${stage.status === 'ready' ? 'bg-emerald-400' : 'bg-[#2c6ef2]'}`}
                        style={{ width: `${stage.progress}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-white/36">
                      <span>{t('workflow.progress', { value: stage.progress })}</span>
                      <span>{t(`workflow.reasons.${stage.reason}`)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/8 pt-3">
                      <span className={`rounded px-2 py-0.5 text-[11px] ${
                        reviewState === 'confirmed'
                          ? 'bg-emerald-400/12 text-emerald-200'
                          : reviewState === 'review'
                            ? 'bg-[#f5a524]/12 text-[#ffd58a]'
                            : 'bg-white/6 text-white/36'
                      }`}>
                        {reviewState ? t(`workflow.reviewStates.${reviewState}`) : t('workflow.reviewStates.unset')}
                      </span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            updateStageReviewState(stage.id, 'confirmed')
                          }}
                          className="rounded border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[11px] font-medium text-emerald-200 transition-colors hover:bg-emerald-400/16"
                        >
                          {t('workflow.actions.confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            updateStageReviewState(stage.id, 'review')
                          }}
                          className="rounded border border-[#f5a524]/22 bg-[#f5a524]/10 px-2 py-1 text-[11px] font-medium text-[#ffd58a] transition-colors hover:bg-[#f5a524]/16"
                        >
                          {t('workflow.actions.review')}
                        </button>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-sm text-white/38">
              {t('workflow.loading')}
            </div>
          )}
        </div>
      )}

      {focus === 'script-review' && (
        <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-white/72">{t('scriptReview.title')}</div>
              <div className="mt-1 text-xs text-white/38">{t('scriptReview.description')}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                {t('scriptReview.total', { count: clips.length })}
              </span>
              <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                {t('scriptReview.storyboards', { count: storyboards.length })}
              </span>
              <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                {t('scriptReview.panels', { count: panels.length })}
              </span>
            </div>
          </div>
          <div className="mb-3 grid gap-2 md:grid-cols-3">
            <div className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
              <div className="text-[11px] text-white/38">{t('scriptReview.locationCoverage')}</div>
              <div className="mt-1 text-sm font-semibold text-white/72">
                {clips.filter((clip) => Boolean(clip.location)).length}/{clips.length}
              </div>
            </div>
            <div className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
              <div className="text-[11px] text-white/38">{t('scriptReview.characterCoverage')}</div>
              <div className="mt-1 text-sm font-semibold text-white/72">
                {clips.filter((clip) => Boolean(clip.characters)).length}/{clips.length}
              </div>
            </div>
            <div className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
              <div className="text-[11px] text-white/38">{t('scriptReview.propCoverage')}</div>
              <div className="mt-1 text-sm font-semibold text-white/72">
                {clips.filter((clip) => Boolean(clip.props)).length}/{clips.length}
              </div>
            </div>
          </div>
          {clips.length > 0 ? (
            <div className="space-y-2">
              {clips.slice(0, 16).map((clip, index) => {
                const linkedStoryboard = storyboards.find((storyboard) => storyboard.clipId === clip.id)
                const linkedPanels = linkedStoryboard?.panels || []
                const clipDuration = typeof clip.duration === 'number'
                  ? formatSeconds(clip.duration)
                  : typeof clip.start === 'number' && typeof clip.end === 'number'
                    ? formatSeconds(Math.max(clip.end - clip.start, 0))
                    : '-'
                const progress = Math.round(([clip.location, clip.characters, clip.screenplay, linkedStoryboard].filter(Boolean).length / 4) * 100)

                return (
                  <div
                    key={clip.id}
                    className="grid gap-3 rounded-md border border-white/8 bg-white/4 p-3 transition-colors hover:border-[#2c6ef2]/55 hover:bg-white/7 md:grid-cols-[72px_1fr_250px]"
                  >
                    <div className="flex h-14 w-14 items-center justify-center rounded-md bg-[#2c6ef2]/14 text-sm font-semibold text-[#9bc3ff]">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-white/74">
                          {displayText(clip.summary, t('scriptReview.clipTitle', { index: index + 1 }))}
                        </div>
                        <span className="rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/42">
                          {clipDuration}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">
                        {displayText(clip.content || clip.screenplay, t('data.noDescription'))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                        <span className={`max-w-[180px] truncate rounded px-2 py-1 ${clip.location ? 'bg-white/6 text-white/42' : 'bg-[#f5a524]/10 text-[#ffd58a]'}`}>
                          {displayText(clip.location, t('scriptReview.noLocation'))}
                        </span>
                        <span className={`max-w-[220px] truncate rounded px-2 py-1 ${clip.characters ? 'bg-white/6 text-white/42' : 'bg-[#f5a524]/10 text-[#ffd58a]'}`}>
                          {displayText(clip.characters, t('scriptReview.noCharacters'))}
                        </span>
                        {clip.props ? (
                          <span className="max-w-[180px] truncate rounded bg-white/6 px-2 py-1 text-white/42">
                            {cleanDisplayText(clip.props)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
                        <span className={`rounded px-2 py-1 ${clip.screenplay ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                          {clip.screenplay ? t('scriptReview.screenplayReady') : t('scriptReview.screenplayMissing')}
                        </span>
                        <span className={`rounded px-2 py-1 ${linkedStoryboard ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                          {linkedStoryboard ? t('scriptReview.storyboardReady') : t('scriptReview.storyboardMissing')}
                        </span>
                        <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                          {t('scriptReview.panelCount', { count: linkedPanels.length })}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full bg-[#2c6ef2]" style={{ width: `${progress}%` }} />
                      </div>
                      <Link
                        href={linkedPanels[0] ? buildShotDetailHref(linkedPanels[0].id) : buildStoryboardHref()}
                        className="inline-flex h-8 w-full items-center justify-center rounded-md border border-white/10 bg-white/6 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
                      >
                        {linkedPanels[0] ? t('scriptReview.openShot') : t('scriptReview.openStoryboard')}
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-sm text-white/38">
              {t('data.empty')}
            </div>
          )}
        </div>
      )}

      {focus === 'script' && (
        <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-white/72">{t('script.title')}</div>
              <div className="mt-1 text-xs text-white/38">{t('script.description')}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className={`rounded px-2 py-1 ${scriptText ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/42'}`}>
                {scriptText ? t('script.storyReady') : t('script.storyMissing')}
              </span>
              <span className={`rounded px-2 py-1 ${srtText ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/42'}`}>
                {srtText ? t('script.srtReady') : t('script.srtMissing')}
              </span>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-md border border-white/8 bg-white/4 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-white/50">{t('script.sourceTitle')}</div>
                <span className="rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/42">
                  {t('script.charCount', { count: countTextChars(displayScriptText || displaySrtText) })}
                </span>
              </div>
              <div className="max-h-44 overflow-auto rounded-md border border-white/8 bg-[#0b0e14] p-3 text-xs leading-6 text-white/48">
                {(displayScriptText || displaySrtText || t('script.noSource')).slice(0, 1800)}
              </div>
            </div>
            <div className="grid gap-2">
              <div className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
                <div className="text-[11px] text-white/38">{t('script.episode')}</div>
                <div className="mt-1 truncate text-sm font-semibold text-white/72">
                  {displayText(episode?.name, t('data.noEpisode'))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
                  <div className="text-[11px] text-white/38">{t('script.ratio')}</div>
                  <div className="mt-1 text-sm font-semibold text-white/72">{projectData?.videoRatio || '-'}</div>
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
                  <div className="text-[11px] text-white/38">{t('script.style')}</div>
                  <div className="mt-1 truncate text-sm font-semibold text-white/72">{displayText(projectData?.artStyle, '-')}</div>
                </div>
              </div>
              <div className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
                <div className="text-[11px] text-white/38">{t('script.model')}</div>
                  <div className="mt-1 truncate text-sm font-semibold text-white/72">{displayText(projectData?.analysisModel, '-')}</div>
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            {[
              { label: t('script.outputs.clips'), value: clips.length, ready: clips.length > 0 },
              { label: t('script.outputs.characters'), value: characters.length, ready: characters.length > 0 },
              { label: t('script.outputs.locations'), value: locations.length, ready: locations.length > 0 },
              { label: t('script.outputs.props'), value: props.length, ready: props.length > 0 },
            ].map((item) => (
              <div key={item.label} className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-white/38">{item.label}</div>
                  <span className={`rounded px-2 py-0.5 text-[11px] ${item.ready ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                    {item.ready ? t('script.ready') : t('script.pending')}
                  </span>
                </div>
                <div className="mt-1 text-lg font-semibold text-white">{item.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/workspace/${projectId}/workbench/script-review${episode?.id ? `?episode=${encodeURIComponent(episode.id)}` : ''}`}
              className="inline-flex h-9 items-center justify-center rounded-md border border-white/10 bg-white/6 px-3 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
            >
              {t('script.openReview')}
            </Link>
            <Link
              href={buildStoryboardHref()}
              className="inline-flex h-9 items-center justify-center rounded-md border border-white/10 bg-white/6 px-3 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
            >
              {t('script.openStoryboard')}
            </Link>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-white/72">{t('data.detailTitle')}</div>
          <span className="text-xs text-white/34">{t('data.showing', { count: detailItems.length })}</span>
        </div>
        {detailItems.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2">
            {detailItems.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-medium text-white/74">{item.title}</div>
                  <span className="shrink-0 rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/42">{item.meta}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">{item.detail}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-sm text-white/38">
            {t('data.empty')}
          </div>
        )}
      </div>

      {assetFocusKind && assetFocusItems.length > 0 && (
        <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-white/72">{t('assets.boardTitle')}</div>
              <div className="mt-1 text-xs text-white/38">{t(`assets.boardDescriptions.${assetFocusKind}`)}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                {t('assets.total', { count: assetFocusItems.length })}
              </span>
              <span className={`rounded px-2 py-1 ${assetMissingImageItems.length === 0 ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/42'}`}>
                {t('assets.imageReady', { ready: assetImageReadyItems.length, total: assetFocusItems.length })}
              </span>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                { label: t('assets.metrics.ready'), value: assetImageReadyItems.length, tone: 'text-[#7ee7c8]' },
                { label: t('assets.metrics.missingImage'), value: assetMissingImageItems.length, tone: 'text-[#f8c96a]' },
                { label: t('assets.metrics.linkedPanels'), value: assetLinkedPanelItems.length, tone: 'text-[#9bc3ff]' },
                { label: t('assets.metrics.scriptOnly'), value: assetScriptOnlyItems.length, tone: 'text-white/74' },
              ].map((item) => (
                <div key={item.label} className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-[11px] text-white/38">{item.label}</div>
                  <div className={`mt-1 text-lg font-semibold ${item.tone}`}>{item.value}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { key: 'missing', title: t('assets.queues.missing.title'), items: assetMissingImageItems, tone: 'border-amber-300/16 bg-amber-300/6' },
                { key: 'script', title: t('assets.queues.scriptOnly.title'), items: assetScriptOnlyItems, tone: 'border-[#2c6ef2]/20 bg-[#2c6ef2]/7' },
              ].map((queue) => (
                <div key={queue.key} className={`rounded-md border p-3 ${queue.tone}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-white/68">{queue.title}</div>
                    <span className="rounded bg-black/20 px-2 py-0.5 text-[11px] font-semibold text-white/58">
                      {queue.items.length}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {queue.items.slice(0, 3).map((item) => (
                      <Link
                        key={item.id}
                        href={item.href}
                        className="block rounded border border-white/8 bg-black/14 px-2 py-2 transition-colors hover:border-[#2c6ef2]/55"
                      >
                        <div className="truncate text-[11px] font-semibold text-white/64">{item.title}</div>
                        <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-white/34">
                          <span>{t('assets.refs.script', { count: item.scriptRefs })}</span>
                          <span>{t('assets.refs.panels', { count: item.panelRefs })}</span>
                          <span>{t('assets.refs.images', { count: item.imageCount })}</span>
                        </div>
                      </Link>
                    ))}
                    {queue.items.length === 0 ? (
                      <div className="rounded border border-dashed border-white/8 px-2 py-4 text-center text-[11px] text-white/30">
                        {t('assets.queueEmpty')}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {(focus === 'characters' || focus === 'items' || focus === 'environments') && assetSelectionItems.length > 0 && (
        <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-white/72">{t('assets.selectTitle')}</div>
            <span className="text-xs text-white/34">{t('data.showing', { count: assetSelectionItems.length })}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {assetSelectionItems.slice(0, 12).map((item) => {
              const active = item.id === selectedAssetId
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`rounded-md border px-3 py-2 transition-colors ${
                    active
                      ? 'border-[#2c6ef2]/60 bg-[#2c6ef2]/12'
                      : 'border-white/8 bg-white/4 hover:border-[#2c6ef2]/45 hover:bg-white/7'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-medium text-white/76">{item.title}</div>
                    <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] ${active ? 'bg-[#2c6ef2]/18 text-[#9bc3ff]' : 'bg-white/6 text-white/42'}`}>
                      {active ? t('assets.selected') : item.meta}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/38">{item.detail}</div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {(focus === 'items' || focus === 'environments' || focus === 'characters' || focus === 'shot-detail') && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[300px_1fr]">
          <div className="overflow-hidden rounded-md border border-white/10 bg-[#10131b]">
            {focus === 'items' && firstAssetImage(selectedProp) ? (
              <img src={firstAssetImage(selectedProp) || ''} alt="" className="aspect-video w-full object-cover" />
            ) : focus === 'environments' && firstAssetImage(selectedLocation) ? (
              <img src={firstAssetImage(selectedLocation) || ''} alt="" className="aspect-video w-full object-cover" />
            ) : focus === 'characters' && firstCharacterImage(selectedCharacter) ? (
              <img src={firstCharacterImage(selectedCharacter) || ''} alt="" className="aspect-video w-full object-cover" />
            ) : focus === 'shot-detail' && selectedPanel?.imageUrl ? (
              <img src={selectedPanel.imageUrl} alt="" className="aspect-video w-full object-cover" />
            ) : (
              <div className="flex aspect-video items-center justify-center bg-white/4 text-white/30">
                <AppIcon name={focus === 'shot-detail' ? 'video' : meta.icon} className="h-8 w-8" />
              </div>
            )}
            <div className="border-t border-white/10 p-3">
              <div className="text-sm font-semibold text-white/72">{t('inspect.preview')}</div>
              <div className="mt-1 text-xs leading-5 text-white/40">
                {focus === 'items'
                  ? selectedProp?.name || t('data.empty')
                  : focus === 'environments'
                    ? selectedLocation?.name || t('data.empty')
                    : focus === 'characters'
                      ? selectedCharacter?.name || t('data.empty')
                      : selectedPanel ? t('inspect.shotNumber', { index: selectedPanelIndex + 1 }) : t('data.empty')}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-[#10131b] p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-white/72">{t('inspect.title')}</div>
              <span className="rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/42">
                {focus === 'shot-detail' ? t('inspect.shotDetail') : t('inspect.assetDetail')}
              </span>
            </div>

            {focus === 'shot-detail' ? (
              <div className="space-y-3">
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/32">
                        {t('shotDetail.boardTitle')}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-white/72">
                        {t('shotDetail.boardDescription')}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                        {selectedPanel ? t('shotDetail.order', { index: selectedPanel.panelIndex + 1 }) : t('data.empty')}
                      </span>
                      <span className={`rounded px-2 py-1 ${selectedPanelRunning ? 'bg-[#2c6ef2]/14 text-[#9bc3ff]' : 'bg-white/6 text-white/42'}`}>
                        {selectedPanelRunning ? t('shotDetail.running') : t('shotDetail.idle')}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
                    {[
                      { label: t('shotDetail.checks.image'), ready: selectedPanelHasImage },
                      { label: t('shotDetail.checks.video'), ready: selectedPanelHasVideo },
                      { label: t('shotDetail.checks.refs'), ready: selectedPanelHasRefs },
                      { label: t('shotDetail.checks.prompts'), ready: selectedPanelHasPrompts },
                      { label: t('shotDetail.checks.duration'), ready: selectedPanelHasDuration },
                      { label: t('shotDetail.checks.errors'), ready: !selectedPanelHasErrors },
                    ].map((item) => (
                      <div key={item.label} className="rounded-md border border-white/8 bg-[#0b0e14] p-3">
                        <div className="text-[11px] text-white/38">{item.label}</div>
                        <div className={`mt-1 text-sm font-semibold ${item.ready ? 'text-emerald-200' : 'text-[#f8c96a]'}`}>
                          {item.ready ? t('shotDetail.ready') : t('shotDetail.pending')}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <div className="rounded-md border border-white/8 bg-[#0b0e14] p-3">
                      <div className="text-xs font-semibold text-white/50">{t('shotDetail.mediaTitle')}</div>
                      <div className="mt-2 space-y-1 text-xs leading-5 text-white/42">
                        <div>{t('shotDetail.imageState')}: {selectedPanelHasImage ? t('data.imageReady') : t('shot.imageMissing')}</div>
                        <div>{t('shotDetail.videoState')}: {selectedPanelHasVideo ? t('data.videoReady') : t('shot.videoMissing')}</div>
                        <div>{t('shotDetail.durationState')}: {formatSeconds(selectedPanel?.duration)}</div>
                      </div>
                    </div>
                    <div className="rounded-md border border-white/8 bg-[#0b0e14] p-3">
                      <div className="text-xs font-semibold text-white/50">{t('shotDetail.refsTitle')}</div>
                      <div className="mt-2 space-y-1 text-xs leading-5 text-white/42">
                        <div>{t('inspect.assetRefs')}: {selectedPanelHasRefs ? t('shot.refsReady') : t('shot.refsMissing')}</div>
                        <div>{t('edit.locationPlaceholder')}: {displayText(selectedPanel?.location, t('data.noLocation'))}</div>
                        <div>{t('edit.charactersPlaceholder')}: {displayText(selectedPanel?.characters, '-')}</div>
                      </div>
                    </div>
                    <div className="rounded-md border border-white/8 bg-[#0b0e14] p-3">
                      <div className="text-xs font-semibold text-white/50">{t('shotDetail.issueTitle')}</div>
                      <div className="mt-2 space-y-1 text-xs leading-5 text-white/42">
                        <div>{t('shotDetail.imageError')}: {displayText(selectedPanel?.imageErrorMessage, '-')}</div>
                        <div>{t('shotDetail.videoError')}: {displayText(selectedPanel?.videoErrorMessage, '-')}</div>
                        <div>{t('shotDetail.taskState')}: {selectedPanelRunning ? t('shotDetail.running') : t('shotDetail.idle')}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-white/8 bg-white/4 p-3 md:col-span-2">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.shotDescription')}</div>
                  <textarea
                    value={draftShotDescription}
                    onChange={(event) => setDraftShotDescription(event.target.value)}
                    className="mt-2 min-h-[92px] w-full resize-y rounded-md border border-white/10 bg-[#0b0e14] px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                    placeholder={t('edit.shotDescriptionPlaceholder')}
                  />
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.shotType')}</div>
                  <input
                    value={draftShotType}
                    onChange={(event) => setDraftShotType(event.target.value)}
                    className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#0b0e14] px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                    placeholder={t('edit.shotTypePlaceholder')}
                  />
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.cameraMove')}</div>
                  <input
                    value={draftCameraMove}
                    onChange={(event) => setDraftCameraMove(event.target.value)}
                    className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#0b0e14] px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                    placeholder={t('edit.cameraMovePlaceholder')}
                  />
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.visualPrompt')}</div>
                  <textarea
                    value={draftImagePrompt}
                    onChange={(event) => setDraftImagePrompt(event.target.value)}
                    className="mt-2 min-h-[128px] w-full resize-y rounded-md border border-white/10 bg-[#0b0e14] px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                    placeholder={t('edit.imagePromptPlaceholder')}
                  />
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.videoPrompt')}</div>
                  <textarea
                    value={draftVideoPrompt}
                    onChange={(event) => setDraftVideoPrompt(event.target.value)}
                    className="mt-2 min-h-[128px] w-full resize-y rounded-md border border-white/10 bg-[#0b0e14] px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                    placeholder={t('edit.videoPromptPlaceholder')}
                  />
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.assetRefs')}</div>
                  <div className="mt-2 space-y-2">
                    <input
                      value={draftShotLocation}
                      onChange={(event) => setDraftShotLocation(event.target.value)}
                      className="h-9 w-full rounded-md border border-white/10 bg-[#0b0e14] px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                      placeholder={t('edit.locationPlaceholder')}
                    />
                    <input
                      value={draftShotCharacters}
                      onChange={(event) => setDraftShotCharacters(event.target.value)}
                      className="h-9 w-full rounded-md border border-white/10 bg-[#0b0e14] px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                      placeholder={t('edit.charactersPlaceholder')}
                    />
                    <input
                      value={draftShotProps}
                      onChange={(event) => setDraftShotProps(event.target.value)}
                      className="h-9 w-full rounded-md border border-white/10 bg-[#0b0e14] px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                      placeholder={t('edit.propsPlaceholder')}
                    />
                  </div>
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.output')}</div>
                  <div className="mt-2 text-sm leading-6 text-white/56">
                    {selectedPanel?.videoUrl || selectedPanel?.lipSyncVideoUrl ? t('data.videoReady') : selectedPanel?.imageUrl ? t('data.imageReady') : t('data.todo')}
                  </div>
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.duration')}</div>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={draftDuration}
                    onChange={(event) => setDraftDuration(event.target.value)}
                    className="mt-2 h-10 w-full rounded-md border border-white/10 bg-[#0b0e14] px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                    placeholder={t('edit.durationPlaceholder')}
                  />
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('timeline.order')}</div>
                  <div className="mt-2 text-sm leading-6 text-white/56">
                    {t('timeline.orderValue', { index: selectedPanel.panelIndex + 1 })}
                  </div>
                </div>
                <div className="md:col-span-2 flex items-center justify-end gap-3">
                  {saveMessage ? <span className="text-xs text-white/45">{saveMessage}</span> : null}
                  <button
                    type="button"
                    onClick={() => { void savePanelDraft() }}
                    disabled={saving || !selectedPanel}
                    className="rounded-md bg-[#2c6ef2] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f5edd] disabled:opacity-50"
                  >
                    {saving ? t('edit.saving') : t('edit.saveShot')}
                  </button>
                </div>
              </div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.description')}</div>
                  {focus === 'items' || focus === 'environments' || focus === 'characters' ? (
                    <div className="mt-2 space-y-2">
                      <input
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        className="h-9 w-full rounded-md border border-white/10 bg-[#0b0e14] px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                        placeholder={t('edit.namePlaceholder')}
                      />
                      <textarea
                        value={draftSummary}
                        onChange={(event) => setDraftSummary(event.target.value)}
                        className="min-h-[104px] w-full resize-y rounded-md border border-white/10 bg-[#0b0e14] px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                        placeholder={t('edit.summaryPlaceholder')}
                      />
                    </div>
                  ) : (
                    <div className="mt-2 line-clamp-5 text-sm leading-6 text-white/56">
                      {selectedCharacter?.introduction || selectedCharacter?.aliases?.join(', ') || t('data.noDescription')}
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.references')}</div>
                  <div className="mt-2 text-sm leading-6 text-white/56">
                    {focus === 'items'
                      ? t('inspect.referenceStats', {
                        clips: clips.filter((clip) => Boolean(clip.props)).length,
                        panels: panels.filter((panel) => Boolean(panel.props)).length,
                      })
                      : focus === 'environments'
                        ? t('inspect.referenceStats', {
                          clips: clips.filter((clip) => Boolean(clip.location)).length,
                          panels: panels.filter((panel) => Boolean(panel.location)).length,
                        })
                        : t('inspect.referenceStats', {
                          clips: clips.filter((clip) => Boolean(clip.characters)).length,
                          panels: panels.filter((panel) => Boolean(panel.characters)).length,
                        })}
                  </div>
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.imageStatus')}</div>
                  <div className="mt-2 text-sm leading-6 text-white/56">
                    {focus === 'items'
                      ? selectedProp?.images?.filter((image) => Boolean(image.imageUrl)).length || 0
                      : focus === 'environments'
                        ? selectedLocation?.images?.filter((image) => Boolean(image.imageUrl)).length || 0
                        : selectedCharacter?.appearances?.filter((appearance) => Boolean(appearance.imageUrl)).length || 0}
                  </div>
                </div>
                <div className="rounded-md border border-white/8 bg-white/4 p-3">
                  <div className="text-xs font-semibold text-white/50">{t('inspect.nextAction')}</div>
                  <div className="mt-2 text-sm leading-6 text-white/56">
                    {t(`items.${focus}.slots.handoff`)}
                  </div>
                </div>
                {(focus === 'items' || focus === 'environments' || focus === 'characters') && (
                  <div className="md:col-span-2 flex items-center justify-end gap-3">
                    {saveMessage ? <span className="text-xs text-white/45">{saveMessage}</span> : null}
                    <button
                      type="button"
                      onClick={() => { void saveAssetDraft() }}
                      disabled={saving || (!(selectedAsset || selectedCharacter) || !draftName.trim())}
                      className="rounded-md bg-[#2c6ef2] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f5edd] disabled:opacity-50"
                    >
                      {saving ? t('edit.saving') : focus === 'characters' ? t('edit.saveCharacter') : t('edit.saveAsset')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {focus === 'episodes' && (
        <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-white/72">{t('episodes.title')}</div>
            <span className="rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/42">
              {t('episodes.total', { count: episodes.length })}
            </span>
          </div>
          {episodes.length > 0 ? (
            <div className="space-y-2">
              {episodes.slice(0, 12).map((item) => {
                const itemPanels = flattenPanels(item)
                const itemVideos = itemPanels.filter((panel) => Boolean(panel.videoUrl || panel.lipSyncVideoUrl))
                const itemImages = itemPanels.filter((panel) => Boolean(panel.imageUrl))
                const progress = itemPanels.length ? Math.round((itemVideos.length / itemPanels.length) * 100) : 0
                return (
                  <Link
                    key={item.id}
                    href={buildEpisodeTimelineHref(item.id)}
                    className="grid gap-3 rounded-md border border-white/8 bg-white/4 p-3 transition-colors hover:border-[#2c6ef2]/55 hover:bg-white/7 md:grid-cols-[88px_1fr_220px]"
                  >
                    <div className="flex h-14 w-16 items-center justify-center rounded-md bg-[#2c6ef2]/14 text-sm font-semibold text-[#9bc3ff]">
                      {t('episodes.index', { index: item.episodeNumber })}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white/74">{displayText(item.name, t('data.empty'))}</div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">
                        {displayText(item.description || item.novelText, t('data.noDescription'))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
                        <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                          {t('episodes.panels', { count: itemPanels.length })}
                        </span>
                        <span className={`rounded px-2 py-1 ${itemImages.length > 0 ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                          {t('episodes.images', { count: itemImages.length })}
                        </span>
                        <span className={`rounded px-2 py-1 ${itemVideos.length > 0 ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                          {t('episodes.videos', { count: itemVideos.length })}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full bg-[#2c6ef2]" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-sm text-white/38">
              {t('data.empty')}
            </div>
          )}
        </div>
      )}

      {focus === 'timbre' && (
        <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-white/72">{t('timbre.title')}</div>
              <div className="mt-1 text-xs text-white/38">{t('timbre.description')}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className={`rounded px-2 py-1 ${episode?.audioUrl ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/42'}`}>
                {episode?.audioUrl ? t('timbre.episodeAudioReady') : t('timbre.episodeAudioMissing')}
              </span>
              <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                {t('timbre.voiceLines', { count: voiceLinesCount })}
              </span>
            </div>
          </div>
          {characters.length > 0 ? (
            <div className="space-y-2">
              {characters.slice(0, 12).map((character) => {
                const hasVoice = Boolean(character.voiceId || character.customVoiceUrl)
                const voiceTypeKey = character.customVoiceUrl
                  ? 'uploaded'
                  : character.voiceType === 'qwen-designed'
                    ? 'qwenDesigned'
                    : character.voiceType === 'custom'
                      ? 'custom'
                      : character.voiceId
                        ? 'bound'
                        : 'missing'
                const clipRefs = clips.filter((clip) => includesText(clip.characters, character.name)).length
                const panelRefs = panels.filter((panel) => includesText(panel.characters, character.name)).length
                const previewImage = firstCharacterImage(character)
                return (
                  <div
                    key={character.id}
                    className="grid gap-3 rounded-md border border-white/8 bg-white/4 p-3 transition-colors hover:border-[#2c6ef2]/55 hover:bg-white/7 md:grid-cols-[72px_1fr_240px]"
                  >
                    <div className="h-14 w-14 overflow-hidden rounded-md border border-white/10 bg-white/6">
                      {previewImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previewImage} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/34">
                          <AppIcon name="usersRound" className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-white/74">{character.name}</div>
                        <span className={`rounded px-2 py-0.5 text-[11px] ${hasVoice ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                          {hasVoice ? t('timbre.ready') : t('timbre.missing')}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">
                        {character.introduction || character.aliases?.join(', ') || t('data.noDescription')}
                      </div>
                      {character.customVoiceUrl ? (
                        <audio controls src={character.customVoiceUrl} className="mt-2 h-8 w-full max-w-md" />
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
                        <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                          {t(`timbre.voiceTypes.${voiceTypeKey}`)}
                        </span>
                        <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                          {t('timbre.clipRefs', { count: clipRefs })}
                        </span>
                        <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                          {t('timbre.panelRefs', { count: panelRefs })}
                        </span>
                      </div>
                      <div className="rounded-md border border-white/8 bg-[#0b0e14] px-3 py-2">
                        <div className="truncate text-[11px] text-white/36">
                          {character.voiceId || character.customVoiceUrl || t('timbre.noVoiceId')}
                        </div>
                      </div>
                      <Link
                        href={buildAssetFocusHref('characters', character.id)}
                        className="inline-flex h-8 w-full items-center justify-center rounded-md border border-white/10 bg-white/6 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
                      >
                        {t('timbre.openCharacter')}
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-sm text-white/38">
              {t('data.empty')}
            </div>
          )}
        </div>
      )}

      {focus === 'storyboard' && (
        <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-white/72">{t('storyboard.title')}</div>
            <span className="rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/42">
              {t('storyboard.total', { count: storyboards.length })}
            </span>
          </div>
          {storyboards.length > 0 ? (
            <div className="space-y-2">
              <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-md border border-white/8 bg-[#0b0e14] p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/32">
                        {t('storyboard.boardTitle')}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-white/72">
                        {t('storyboard.boardDescription')}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={buildShotQueueHref()}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-white/10 bg-white/6 px-3 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
                      >
                        {t('storyboard.openShotQueue')}
                      </Link>
                      <Link
                        href={episode?.id ? buildEpisodeTimelineHref(episode.id) : buildShotQueueHref()}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-white/10 bg-white/6 px-3 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
                      >
                        {t('storyboard.openTimeline')}
                      </Link>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    {[
                      { label: t('storyboard.expectedPanels'), value: storyboardExpectedPanels, tone: 'text-white/74' },
                      { label: t('storyboard.panelReady'), value: panels.length, tone: 'text-[#9bc3ff]' },
                      { label: t('storyboard.imageCoverage'), value: `${imagePanels.length}/${panels.length}`, tone: 'text-[#f8c96a]' },
                      { label: t('storyboard.videoCoverage'), value: `${videoPanels.length}/${panels.length}`, tone: 'text-[#7ee7c8]' },
                    ].map((item) => (
                      <div key={item.label} className="rounded-md border border-white/8 bg-white/4 p-3">
                        <div className="text-[11px] text-white/38">{item.label}</div>
                        <div className={`mt-1 text-lg font-semibold ${item.tone}`}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-white/8 bg-[#0b0e14] p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/32">
                    {t('storyboard.qualityTitle')}
                  </div>
                  <div className="mt-3 space-y-2">
                    {[
                      { label: t('storyboard.needsPanels'), value: storyboardsNeedingPanels.length, tone: storyboardsNeedingPanels.length ? 'bg-amber-400/12 text-amber-200' : 'bg-white/6 text-white/42' },
                      { label: t('storyboard.needsRefs'), value: storyboardsNeedingRefs.length, tone: storyboardsNeedingRefs.length ? 'bg-[#2c6ef2]/14 text-[#9bc3ff]' : 'bg-white/6 text-white/42' },
                      { label: t('storyboard.needsImages'), value: storyboardsNeedingImages.length, tone: storyboardsNeedingImages.length ? 'bg-amber-400/12 text-amber-200' : 'bg-white/6 text-white/42' },
                      { label: t('storyboard.videoReadyGroups'), value: storyboardsWithVideoReady.length, tone: storyboardsWithVideoReady.length ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/42' },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between rounded-md border border-white/8 bg-white/4 px-3 py-2">
                        <span className="text-xs text-white/46">{item.label}</span>
                        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${item.tone}`}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-2 lg:grid-cols-4">
                {[
                  { key: 'panel', title: t('storyboard.columns.panel.title'), description: t('storyboard.columns.panel.description'), items: storyboardsNeedingPanels, tone: 'border-amber-300/16 bg-amber-300/6' },
                  { key: 'refs', title: t('storyboard.columns.refs.title'), description: t('storyboard.columns.refs.description'), items: storyboardsNeedingRefs, tone: 'border-[#2c6ef2]/20 bg-[#2c6ef2]/7' },
                  { key: 'image', title: t('storyboard.columns.image.title'), description: t('storyboard.columns.image.description'), items: storyboardsNeedingImages, tone: 'border-amber-300/16 bg-amber-300/6' },
                  { key: 'ready', title: t('storyboard.columns.ready.title'), description: t('storyboard.columns.ready.description'), items: storyboardsWithVideoReady, tone: 'border-emerald-300/16 bg-emerald-300/6' },
                ].map((column) => (
                  <div key={column.key} className={`rounded-md border p-3 ${column.tone}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-white/68">{column.title}</div>
                        <div className="mt-1 text-[11px] leading-4 text-white/34">{column.description}</div>
                      </div>
                      <span className="rounded bg-black/20 px-2 py-0.5 text-[11px] font-semibold text-white/58">
                        {column.items.length}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {column.items.slice(0, 3).map((storyboard, columnIndex) => {
                        const firstPanel = storyboard.panels?.[0]
                        const clip = clips.find((item) => item.id === storyboard.clipId)
                        return (
                          <Link
                            key={storyboard.id}
                            href={firstPanel ? buildShotDetailHref(firstPanel.id) : buildStoryboardHref()}
                            className="block rounded border border-white/8 bg-black/14 px-2 py-2 transition-colors hover:border-[#2c6ef2]/55"
                          >
                            <div className="truncate text-[11px] font-semibold text-white/64">
                              {t('storyboard.groupIndex', { index: storyboards.findIndex((item) => item.id === storyboard.id) + 1 || columnIndex + 1 })}
                            </div>
                            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/38">
                              {displayText(clip?.summary, t('storyboard.untitled'))}
                            </div>
                          </Link>
                        )
                      })}
                      {column.items.length === 0 ? (
                        <div className="rounded border border-dashed border-white/8 px-2 py-4 text-center text-[11px] text-white/30">
                          {t('storyboard.columnEmpty')}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              {storyboards.slice(0, 12).map((storyboard: NovelPromotionStoryboard, index) => {
                const itemPanels = storyboard.panels || []
                const itemImages = itemPanels.filter((panel) => Boolean(panel.imageUrl))
                const itemVideos = itemPanels.filter((panel) => Boolean(panel.videoUrl || panel.lipSyncVideoUrl))
                const linkedRefs = countPanelAssetRefs(itemPanels)
                const expectedPanels = Math.max(storyboard.panelCount || 0, itemPanels.length)
                const progress = expectedPanels ? Math.round((itemVideos.length / expectedPanels) * 100) : 0
                const clip = clips.find((item) => item.id === storyboard.clipId)
                const firstPanel = itemPanels[0]

                return (
                  <div
                    key={storyboard.id}
                    className="grid gap-3 rounded-md border border-white/8 bg-white/4 p-3 transition-colors hover:border-[#2c6ef2]/55 hover:bg-white/7 md:grid-cols-[88px_1fr_240px]"
                  >
                    <div className="flex h-14 w-16 items-center justify-center rounded-md bg-[#2c6ef2]/14 text-sm font-semibold text-[#9bc3ff]">
                      {t('storyboard.groupIndex', { index: index + 1 })}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white/74">
                        {displayText(clip?.summary, t('storyboard.untitled'))}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">
                        {displayText(clip?.content || storyboard.storyboardTextJson, t('data.noDescription'))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                        <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                          {displayText(clip?.location, t('data.noLocation'))}
                        </span>
                        {clip?.characters ? (
                          <span className="max-w-[220px] truncate rounded bg-white/6 px-2 py-1 text-white/42">
                            {cleanDisplayText(clip.characters)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
                        <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                          {t('storyboard.panels', { count: itemPanels.length })}
                        </span>
                        <span className={`rounded px-2 py-1 ${itemImages.length > 0 ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                          {t('storyboard.images', { count: itemImages.length })}
                        </span>
                        <span className={`rounded px-2 py-1 ${itemVideos.length > 0 ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                          {t('storyboard.videos', { count: itemVideos.length })}
                        </span>
                        <span className={`rounded px-2 py-1 ${linkedRefs > 0 ? 'bg-[#2c6ef2]/14 text-[#9bc3ff]' : 'bg-white/6 text-white/34'}`}>
                          {t('storyboard.linkedRefs', { count: linkedRefs })}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full bg-[#2c6ef2]" style={{ width: `${progress}%` }} />
                      </div>
                      {firstPanel ? (
                        <Link
                          href={buildShotDetailHref(firstPanel.id)}
                          className="inline-flex h-8 w-full items-center justify-center rounded-md border border-white/10 bg-white/6 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
                        >
                          {t('storyboard.openFirstShot')}
                        </Link>
                      ) : (
                        <div className="flex h-8 items-center justify-center rounded-md border border-dashed border-white/10 text-xs text-white/34">
                          {t('storyboard.noPanels')}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-sm text-white/38">
              {t('data.empty')}
            </div>
          )}
        </div>
      )}

      {focus === 'export' && (
        <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-white/72">{t('export.title')}</div>
              <div className="mt-1 text-xs text-white/38">{t('export.description')}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className={`rounded px-2 py-1 ${missingVideoCount === 0 && panels.length > 0 ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/42'}`}>
                {t('export.videoCoverage', { ready: videoPanels.length, total: panels.length })}
              </span>
              <span className={`rounded px-2 py-1 ${missingImageCount === 0 && panels.length > 0 ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/42'}`}>
                {t('export.imageCoverage', { ready: imagePanels.length, total: panels.length })}
              </span>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                id: 'final-video',
                icon: 'video' as AppIconName,
                title: t('export.cards.finalVideo.title'),
                detail: t('export.cards.finalVideo.detail', { ready: videoPanels.length, total: panels.length }),
                ready: panels.length > 0 && missingVideoCount === 0,
                missing: missingVideoCount,
              },
              {
                id: 'asset-package',
                icon: 'package' as AppIconName,
                title: t('export.cards.assetPackage.title'),
                detail: t('export.cards.assetPackage.detail', { ready: imagePanels.length, total: panels.length }),
                ready: imagePanels.length > 0,
                missing: missingImageCount,
              },
              {
                id: 'manifest',
                icon: 'fileText' as AppIconName,
                title: t('export.cards.manifest.title'),
                detail: t('export.cards.manifest.detail', {
                  clips: clips.length,
                  storyboards: storyboards.length,
                  panels: panels.length,
                }),
                ready: clips.length > 0 || panels.length > 0,
                missing: 0,
              },
              {
                id: 'audio',
                icon: 'audioWave' as AppIconName,
                title: t('export.cards.audio.title'),
                detail: episode?.audioUrl ? t('export.cards.audio.ready') : t('export.cards.audio.missing', { count: voiceLinesCount }),
                ready: Boolean(episode?.audioUrl || voiceLinesCount > 0),
                missing: episode?.audioUrl || voiceLinesCount > 0 ? 0 : 1,
              },
            ].map((card) => (
              <div key={card.id} className="rounded-md border border-white/8 bg-white/4 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white/6">
                    <AppIcon name={card.icon} className="h-4 w-4 text-[#9bc3ff]" />
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[11px] ${card.ready ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                    {card.ready ? t('export.ready') : t('export.notReady')}
                  </span>
                </div>
                <div className="text-sm font-semibold text-white/74">{card.title}</div>
                <div className="mt-2 min-h-10 text-xs leading-5 text-white/42">{card.detail}</div>
                {card.missing > 0 ? (
                  <div className="mt-2 rounded border border-[#f5a524]/20 bg-[#f5a524]/10 px-2 py-1 text-[11px] text-[#ffd58a]">
                    {t('export.missing', { count: card.missing })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={episode?.id ? buildEpisodeTimelineHref(episode.id) : buildShotQueueHref()}
              className="inline-flex h-9 items-center justify-center rounded-md border border-white/10 bg-white/6 px-3 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
            >
              {t('export.openTimeline')}
            </Link>
            <Link
              href={buildShotQueueHref()}
              className="inline-flex h-9 items-center justify-center rounded-md border border-white/10 bg-white/6 px-3 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
            >
              {t('export.openShots')}
            </Link>
            <span className="inline-flex h-9 items-center rounded-md border border-white/8 bg-[#0b0e14] px-3 text-xs text-white/38">
              {t('export.useStageDownloads')}
            </span>
          </div>
        </div>
      )}

      {focus === 'shot' && (
        <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-white/72">{t('shot.title')}</div>
              <div className="mt-1 text-xs text-white/38">{t('shot.description')}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded bg-white/6 px-2 py-1 text-white/42">
                {t('shot.total', { count: panels.length })}
              </span>
              <span className={`rounded px-2 py-1 ${imagePanels.length === panels.length && panels.length > 0 ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/42'}`}>
                {t('shot.imagesReady', { ready: imagePanels.length, total: panels.length })}
              </span>
              <span className={`rounded px-2 py-1 ${videoPanels.length === panels.length && panels.length > 0 ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/42'}`}>
                {t('shot.videosReady', { ready: videoPanels.length, total: panels.length })}
              </span>
            </div>
          </div>
          {panels.length > 0 ? (
            <div className="space-y-2">
              <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-md border border-white/8 bg-[#0b0e14] p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/32">
                        {t('shot.overviewTitle')}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-white/72">
                        {t('shot.overviewDescription')}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={episode?.id ? buildEpisodeTimelineHref(episode.id) : buildShotQueueHref()}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-white/10 bg-white/6 px-3 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
                      >
                        {t('shot.openTimeline')}
                      </Link>
                      <Link
                        href={`/workspace/${projectId}/workbench/production/export${episode?.id ? `?episode=${encodeURIComponent(episode.id)}` : ''}`}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-white/10 bg-white/6 px-3 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
                      >
                        {t('shot.openExport')}
                      </Link>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    {[
                      { label: t('shot.pendingImages'), value: pendingImagePanels.length, tone: 'text-[#f8c96a]' },
                      { label: t('shot.pendingVideos'), value: pendingVideoPanels.length, tone: 'text-[#8ab8ff]' },
                      { label: t('shot.deliverable'), value: deliverablePanels.length, tone: 'text-[#7ee7c8]' },
                      { label: t('shot.averageDuration'), value: formatSeconds(averageDuration), tone: 'text-white/74' },
                    ].map((item) => (
                      <div key={item.label} className="rounded-md border border-white/8 bg-white/4 p-3">
                        <div className="text-[11px] text-white/38">{item.label}</div>
                        <div className={`mt-1 text-lg font-semibold ${item.tone}`}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-white/8 bg-[#0b0e14] p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/32">
                    {t('shot.healthTitle')}
                  </div>
                  <div className="mt-3 space-y-2">
                    {[
                      { label: t('shot.running'), value: runningPanels.length, tone: runningPanels.length ? 'bg-[#2c6ef2]/14 text-[#9bc3ff]' : 'bg-white/6 text-white/42' },
                      { label: t('shot.imageErrors'), value: imageErrorCount, tone: imageErrorCount ? 'bg-rose-500/12 text-rose-200' : 'bg-white/6 text-white/42' },
                      { label: t('shot.videoErrors'), value: videoErrorCount, tone: videoErrorCount ? 'bg-rose-500/12 text-rose-200' : 'bg-white/6 text-white/42' },
                      { label: t('shot.refsMissingCount'), value: panels.filter((panel) => !hasPanelRefs(panel)).length, tone: panels.some((panel) => !hasPanelRefs(panel)) ? 'bg-amber-400/12 text-amber-200' : 'bg-white/6 text-white/42' },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between rounded-md border border-white/8 bg-white/4 px-3 py-2">
                        <span className="text-xs text-white/46">{item.label}</span>
                        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${item.tone}`}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-2 lg:grid-cols-4">
                {[
                  { key: 'image', title: t('shot.columns.image.title'), description: t('shot.columns.image.description'), items: pendingImagePanels, tone: 'border-amber-300/16 bg-amber-300/6' },
                  { key: 'video', title: t('shot.columns.video.title'), description: t('shot.columns.video.description'), items: pendingVideoPanels, tone: 'border-[#2c6ef2]/20 bg-[#2c6ef2]/7' },
                  { key: 'delivery', title: t('shot.columns.delivery.title'), description: t('shot.columns.delivery.description'), items: deliverablePanels, tone: 'border-emerald-300/16 bg-emerald-300/6' },
                  { key: 'attention', title: t('shot.columns.attention.title'), description: t('shot.columns.attention.description'), items: attentionPanels, tone: 'border-rose-300/16 bg-rose-300/6' },
                ].map((column) => (
                  <div key={column.key} className={`rounded-md border p-3 ${column.tone}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-white/68">{column.title}</div>
                        <div className="mt-1 text-[11px] leading-4 text-white/34">{column.description}</div>
                      </div>
                      <span className="rounded bg-black/20 px-2 py-0.5 text-[11px] font-semibold text-white/58">
                        {column.items.length}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {column.items.slice(0, 3).map((panel) => (
                        <Link
                          key={panel.id}
                          href={buildShotDetailHref(panel.id)}
                          className="block rounded border border-white/8 bg-black/14 px-2 py-2 transition-colors hover:border-[#2c6ef2]/55"
                        >
                          <div className="truncate text-[11px] font-semibold text-white/64">
                            {t('shot.order', { index: panel.panelIndex + 1 })}
                          </div>
                          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/38">
                            {pickPanelTitle(panel, panel.panelIndex)}
                          </div>
                        </Link>
                      ))}
                      {column.items.length === 0 ? (
                        <div className="rounded border border-dashed border-white/8 px-2 py-4 text-center text-[11px] text-white/30">
                          {t('shot.columnEmpty')}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              {panels.slice(0, 16).map((panel, index) => {
                const hasImage = Boolean(panel.imageUrl)
                const hasVideo = hasPanelVideo(panel)
                const hasRefs = hasPanelRefs(panel)
                const readiness = [hasImage, hasVideo, hasRefs].filter(Boolean).length
                const completion = Math.round((readiness / 3) * 100)

                return (
                  <div
                    key={panel.id}
                    className="grid gap-3 rounded-md border border-white/8 bg-white/4 p-3 transition-colors hover:border-[#2c6ef2]/55 hover:bg-white/7 md:grid-cols-[96px_1fr_260px]"
                  >
                    <div className="h-16 w-24 overflow-hidden rounded-md border border-white/10 bg-white/6">
                      {panel.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={panel.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-white/34">
                          {t('shot.noImage')}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium text-white/74">
                          {pickPanelTitle(panel, index)}
                        </div>
                        <span className="rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/42">
                          {t('shot.order', { index: panel.panelIndex + 1 })}
                        </span>
                        {panel.duration ? (
                          <span className="rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/42">
                            {t('shot.duration', { value: Number(panel.duration).toFixed(1) })}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">
                        {displayText(panel.videoPrompt || panel.imagePrompt || panel.description, t('data.noDescription'))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                        <span className="max-w-[180px] truncate rounded bg-white/6 px-2 py-1 text-white/42">
                          {displayText(panel.location, t('data.noLocation'))}
                        </span>
                        {panel.characters ? (
                          <span className="max-w-[220px] truncate rounded bg-white/6 px-2 py-1 text-white/42">
                            {cleanDisplayText(panel.characters)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
                        <span className={`rounded px-2 py-1 ${hasImage ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                          {hasImage ? t('shot.imageReady') : t('shot.imageMissing')}
                        </span>
                        <span className={`rounded px-2 py-1 ${hasVideo ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                          {hasVideo ? t('shot.videoReady') : t('shot.videoMissing')}
                        </span>
                        <span className={`rounded px-2 py-1 ${hasRefs ? 'bg-[#2c6ef2]/14 text-[#9bc3ff]' : 'bg-white/6 text-white/34'}`}>
                          {hasRefs ? t('shot.refsReady') : t('shot.refsMissing')}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full bg-[#2c6ef2]" style={{ width: `${completion}%` }} />
                      </div>
                      <Link
                        href={buildShotDetailHref(panel.id)}
                        className="inline-flex h-8 w-full items-center justify-center rounded-md border border-white/10 bg-white/6 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
                      >
                        {t('shot.openDetail')}
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-sm text-white/38">
              {t('data.empty')}
            </div>
          )}
        </div>
      )}

      {focus === 'timeline' && (
        <div className="mt-4 rounded-md border border-white/10 bg-[#10131b] p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-white/72">{t('timeline.title')}</div>
            <div className="flex items-center gap-2">
              {saveMessage ? <span className="text-[11px] text-white/42">{saveMessage}</span> : null}
              <button
                type="button"
                onClick={() => { void saveTimelineDrafts() }}
                disabled={saving || timelineOrderedPanels.length === 0}
                className="rounded-md bg-[#2c6ef2] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1f5edd] disabled:opacity-50"
              >
                {saving ? t('edit.saving') : t('timeline.save')}
              </button>
              <span className="text-[11px] text-white/34">{t('timeline.openDetail')}</span>
              <span className="rounded bg-white/6 px-2 py-0.5 text-[11px] text-white/42">
                {timelineStats?.videos ?? videoPanels.length}/{timelineStats?.panels ?? panels.length}
              </span>
            </div>
          </div>
          <div className="mb-3 grid gap-2 md:grid-cols-3">
            <div className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
              <div className="text-[11px] text-white/38">{t('timeline.durationTotal')}</div>
              <div className="mt-1 text-sm font-semibold text-white/72">{totalDuration > 0 ? `${Number(totalDuration.toFixed(1))}s` : '-'}</div>
            </div>
            <div className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
              <div className="text-[11px] text-white/38">{t('timeline.imageMissing')}</div>
              <div className="mt-1 text-sm font-semibold text-white/72">{timelineStats?.missingImages ?? Math.max(panels.length - imagePanels.length, 0)}</div>
            </div>
            <div className="rounded-md border border-white/8 bg-white/4 px-3 py-2">
              <div className="text-[11px] text-white/38">{t('timeline.videoMissing')}</div>
              <div className="mt-1 text-sm font-semibold text-white/72">{timelineStats?.missingVideos ?? Math.max(panels.length - videoPanels.length, 0)}</div>
            </div>
          </div>
          {timelineOrderedPanels.length > 0 ? (
            <div className="mb-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-md border border-white/8 bg-[#0b0e14] p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/32">
                      {t('timeline.boardTitle')}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-white/72">
                      {t('timeline.boardDescription')}
                    </div>
                  </div>
                  <span className="rounded bg-white/6 px-2 py-1 text-[11px] text-white/42">
                    {t('timeline.deliveryReady', { ready: timelineReadyPanels.length, total: timelineStats?.panels ?? panels.length })}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {[
                    { label: t('timeline.averageDuration'), value: formatSeconds(averageDuration), tone: 'text-white/74' },
                    { label: t('timeline.refsMissing'), value: timelineMissingRefs.length, tone: timelineMissingRefs.length ? 'text-[#f8c96a]' : 'text-[#7ee7c8]' },
                    { label: t('timeline.durationMissing'), value: timelineMissingDuration.length, tone: timelineMissingDuration.length ? 'text-[#f8c96a]' : 'text-[#7ee7c8]' },
                    { label: t('timeline.readyShots'), value: timelineReadyPanels.length, tone: 'text-[#7ee7c8]' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-md border border-white/8 bg-white/4 p-3">
                      <div className="text-[11px] text-white/38">{item.label}</div>
                      <div className={`mt-1 text-lg font-semibold ${item.tone}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { key: 'refs', title: t('timeline.queues.refs.title'), items: timelineMissingRefs, tone: 'border-amber-300/16 bg-amber-300/6' },
                  { key: 'duration', title: t('timeline.queues.duration.title'), items: timelineMissingDuration, tone: 'border-[#2c6ef2]/20 bg-[#2c6ef2]/7' },
                ].map((queue) => (
                  <div key={queue.key} className={`rounded-md border p-3 ${queue.tone}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-white/68">{queue.title}</div>
                      <span className="rounded bg-black/20 px-2 py-0.5 text-[11px] font-semibold text-white/58">
                        {queue.items.length}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {queue.items.slice(0, 3).map((panel, queueIndex) => (
                        <Link
                          key={panel.id}
                          href={buildShotDetailHref(panel.id)}
                          className="block rounded border border-white/8 bg-black/14 px-2 py-2 transition-colors hover:border-[#2c6ef2]/55"
                        >
                          <div className="truncate text-[11px] font-semibold text-white/64">
                            {t('timeline.orderValue', { index: panel.panelIndex + 1 || queueIndex + 1 })}
                          </div>
                          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/38">
                            {pickPanelTitle(panel, panel.panelIndex)}
                          </div>
                        </Link>
                      ))}
                      {queue.items.length === 0 ? (
                        <div className="rounded border border-dashed border-white/8 px-2 py-4 text-center text-[11px] text-white/30">
                          {t('timeline.queueEmpty')}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {timelineOrderedPanels.length > 0 ? (
            <div className="space-y-2">
              {timelinePanelRows.slice(0, 12).map(({ panel, row }, index) => {
                const hasVideo = row.readiness.hasVideo
                const hasImage = row.readiness.hasImage
                const storyboardPanels = panels
                  .filter((item) => item.storyboardId === panel.storyboardId)
                  .sort((a, b) => a.panelIndex - b.panelIndex)
                const storyboardPanelIndex = storyboardPanels.findIndex((item) => item.id === panel.id)
                const canMoveUp = storyboardPanelIndex > 0
                const canMoveDown = storyboardPanelIndex >= 0 && storyboardPanelIndex < storyboardPanels.length - 1
                const draft = timelineDrafts[panel.id] || {
                  duration: panel.duration ? String(panel.duration) : '',
                  shotType: cleanDisplayText(panel.shotType),
                  cameraMove: cleanDisplayText(panel.cameraMove),
                }
                return (
                  <div
                    key={panel.id}
                    className="grid gap-3 rounded-md border border-white/8 bg-white/4 p-3 transition-colors hover:border-[#2c6ef2]/55 hover:bg-white/7 md:grid-cols-[72px_1fr_230px]"
                  >
                    <div className="flex h-14 w-14 items-center justify-center rounded-md bg-white/6 text-sm font-semibold text-white/62">
                      {row.timelineIndex || index + 1}
                    </div>
                    <div className="min-w-0 space-y-2">
                      <div className="truncate text-sm font-medium text-white/74">{pickPanelTitle(panel, index)}</div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-white/40">
                        {displayText(panel.videoPrompt || panel.imagePrompt || panel.characters || panel.location, t('data.noDescription'))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/32">
                        <span>{t('timeline.orderValue', { index: row.timelineIndex || panel.panelIndex + 1 })}</span>
                        <button
                          type="button"
                          onClick={() => { void moveTimelinePanel(panel.id, 'up') }}
                          disabled={saving || !canMoveUp}
                          className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-white/46 transition-colors hover:border-[#2c6ef2]/55 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          {t('timeline.moveUp')}
                        </button>
                        <button
                          type="button"
                          onClick={() => { void moveTimelinePanel(panel.id, 'down') }}
                          disabled={saving || !canMoveDown}
                          className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-white/46 transition-colors hover:border-[#2c6ef2]/55 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          {t('timeline.moveDown')}
                        </button>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <input
                          value={draft.shotType}
                          onChange={(event) => updateTimelineDraft(panel.id, { shotType: event.target.value })}
                          className="h-8 rounded-md border border-white/10 bg-[#0b0e14] px-2 text-xs text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                          placeholder={t('edit.shotTypePlaceholder')}
                        />
                        <input
                          value={draft.cameraMove}
                          onChange={(event) => updateTimelineDraft(panel.id, { cameraMove: event.target.value })}
                          className="h-8 rounded-md border border-white/10 bg-[#0b0e14] px-2 text-xs text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                          placeholder={t('edit.cameraMovePlaceholder')}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
                        <span className={`rounded px-2 py-1 ${hasImage ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                          {t('timeline.image')}
                        </span>
                        <span className={`rounded px-2 py-1 ${hasVideo ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-white/34'}`}>
                          {t('timeline.video')}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={draft.duration}
                          onChange={(event) => updateTimelineDraft(panel.id, { duration: event.target.value })}
                          className="h-7 rounded border border-white/10 bg-[#0b0e14] px-2 text-center text-[11px] text-white outline-none placeholder:text-white/28 focus:border-[#2c6ef2]"
                          placeholder={t('timeline.duration')}
                        />
                      </div>
                      <Link
                        href={buildShotDetailHref(panel.id)}
                        className="inline-flex h-8 w-full items-center justify-center rounded-md border border-white/10 bg-white/6 text-xs font-semibold text-white/58 transition-colors hover:border-[#2c6ef2]/55 hover:text-white"
                      >
                        {t('timeline.detail')}
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center text-sm text-white/38">
              {t('data.empty')}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
