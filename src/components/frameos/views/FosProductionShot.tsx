'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import {
  extractSeedanceVideoPromptBody,
  formatSeedancePromptForEditor,
} from '@/lib/novel-promotion/seedance-prompt-assets'
import type { FosProjectData } from '../useFosProject'
import { MaterialPickerDialog } from '../materials/MaterialPickerDialog'
import { MentionPromptEditor } from '../materials/MentionPromptEditor'
import type { FrameosMaterialItem } from '../materials/contracts'
import { formatVideoReviewTimecode } from '../assignments-view-model'
import { useEpisodeVideoReview } from '../useEpisodeVideoReview'
import { FosProductionModeTabs } from './FosProductionModeTabs'

type RefKind = 'character' | 'prop' | 'location'
interface PanelRef { materialId?: string | null; kind: '角色' | '物品' | '环境'; name: string; imageUrl?: string | null }
interface RawPanel {
  id: string
  panelIndex: number
  panelNumber?: number | null
  shotType?: string | null
  cameraMove?: string | null
  description?: string | null
  duration?: number | null
  videoPrompt?: string | null
  imageUrl?: string | null
  videoUrl?: string | null
  lipSyncVideoUrl?: string | null
  assetBindings?: PanelRef[]
}
interface RawStoryboard { id: string; clip?: { location?: string | null } | null; panels?: RawPanel[] }
interface Shot extends RawPanel { storyboardId: string; scene: string; title: string; refs: PanelRef[] }
interface ModelItem {
  modelKey: string
  name: string
  tier?: 'mini' | 'fast' | 'standard' | 'pro'
  options: Record<string, Array<string | number | boolean>>
  firstLastFrame: boolean
  supportGenerateAudio: boolean
  available?: boolean
  unavailableReason?: string | null
}
interface GenerationConfig { videoModels: ModelItem[]; defaults: { videoModel: string | null; resolution: string | null } }
interface TaskItem { id: string; targetId?: string | null; status: string; progress: number; errorMessage?: string | null; createdAt: string; result?: Record<string, unknown> | null }

const MODEL_TIER_LABELS: Record<NonNullable<ModelItem['tier']>, string> = {
  mini: 'Mini',
  fast: 'Fast',
  standard: '标准',
  pro: 'Pro',
}

function modelOptionLabel(model: ModelItem) {
  return `${model.name} · ${MODEL_TIER_LABELS[model.tier || 'standard']}`
}

function kindToApi(kind: PanelRef['kind']): RefKind {
  return kind === '角色' ? 'character' : kind === '环境' ? 'location' : 'prop'
}

function apiToKind(kind: string): PanelRef['kind'] {
  return kind === 'character' ? '角色' : kind === 'location' ? '环境' : '物品'
}

function shotVideoReady(shot: Pick<RawPanel, 'videoUrl' | 'lipSyncVideoUrl'>) {
  return Boolean(shot.lipSyncVideoUrl?.trim() || shot.videoUrl?.trim())
}

function normalizedAssetName(value: string) {
  return value.toLowerCase().replace(/[\s"'“”‘’`·。、，,;；:：()（）[\]【】\-_/|]/g, '')
}

function flattenStoryboards(storyboards: RawStoryboard[]): Shot[] {
  const shots: Shot[] = []
  storyboards.forEach((storyboard, sceneIndex) => {
    const scene = `S${String(sceneIndex + 1).padStart(2, '0')}`
    for (const panel of [...(storyboard.panels || [])].sort((left, right) => left.panelIndex - right.panelIndex)) {
      shots.push({
        ...panel,
        storyboardId: storyboard.id,
        scene,
        title: panel.shotType || panel.description?.slice(0, 24) || storyboard.clip?.location || `镜头 ${panel.panelNumber ?? panel.panelIndex + 1}`,
        refs: Array.isArray(panel.assetBindings) ? panel.assetBindings : [],
      })
    }
  })
  return shots
}

function ShotPreview({ shot }: { shot: Shot }) {
  const video = toDisplayImageUrl(shot.lipSyncVideoUrl || shot.videoUrl)
  const image = toDisplayImageUrl(shot.imageUrl)
  if (video) return <video key={video} src={video} controls playsInline className="h-full w-full object-contain" />
  if (image) return <MediaImage src={image} alt={shot.title} fill sizes="800px" style={{ objectFit: 'contain' }} />
  return <div className="text-center text-[var(--fos-text-4)]"><AppIcon name="video" className="mx-auto mb-2 h-14 w-14" /><div className="text-[14px] font-bold">当前镜头暂无可用视频</div><div className="mt-1 text-[12px]">在右侧确认素材、提示词和输出参数后生成。</div></div>
}

export function FosProductionShot({
  data,
  initialEpisodeId,
}: {
  data: FosProjectData
  initialEpisodeId?: string
}) {
  const { data: session } = useSession()
  const roleCanEdit = hasAccountPermissions({ role: session?.user?.role, permissions: session?.user?.permissions }, ['storyboardWrite'])
  const preferredEpisodeId = data.episodes.find((episode) => episode.id === initialEpisodeId)?.id || data.episodes[0]?.id || ''
  const [episodeId, setEpisodeId] = useState(preferredEpisodeId)
  const [shots, setShots] = useState<Shot[]>([])
  const [activeShotId, setActiveShotId] = useState('')
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState<GenerationConfig | null>(null)
  const [modelKey, setModelKey] = useState('')
  const [resolution, setResolution] = useState('')
  const [duration, setDuration] = useState(5)
  const [generateAudio, setGenerateAudio] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [stylePrompt, setStylePrompt] = useState('院线电影质感，保持角色、服装、场景、道具与相邻镜头连续。')
  const [refs, setRefs] = useState<PanelRef[]>([])
  const [pickerKind, setPickerKind] = useState<PanelRef['kind'] | null>(null)
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [episodeActiveTasks, setEpisodeActiveTasks] = useState<TaskItem[]>([])
  const [centerTab, setCenterTab] = useState<'history' | 'review'>('history')
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const activeShot = shots.find((shot) => shot.id === activeShotId) || shots[0] || null

  useEffect(() => {
    setEpisodeId((current) => data.episodes.some((episode) => episode.id === current) ? current : preferredEpisodeId)
  }, [data.episodes, preferredEpisodeId])

  const loadShots = useCallback(async (keepSelection = true) => {
    if (!episodeId) { setShots([]); setEpisodeActiveTasks([]); return }
    setLoading(true)
    try {
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/storyboards?episodeId=${encodeURIComponent(episodeId)}`)
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载镜头失败'))
      const payload = await response.json() as { storyboards?: RawStoryboard[] }
      const next = flattenStoryboards(Array.isArray(payload.storyboards) ? payload.storyboards : [])
      setShots(next)
      setActiveShotId((current) => keepSelection && next.some((shot) => shot.id === current) ? current : next[0]?.id || '')
    } catch (loadError) {
      setShots([])
      setError(loadError instanceof Error ? loadError.message : '加载镜头失败')
    } finally { setLoading(false) }
  }, [data.projectId, episodeId])

  useEffect(() => { void loadShots(false) }, [loadShots])
  useEffect(() => {
    void apiFetch(`/api/frameos/generation-config?projectId=${encodeURIComponent(data.projectId)}`).then(async (response) => {
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载视频模型失败'))
      return await response.json() as GenerationConfig
    }).then((next) => {
      setConfig(next)
      setModelKey(
        next.videoModels.find((model) => model.modelKey === next.defaults.videoModel && model.available !== false)?.modelKey
          || next.videoModels.find((model) => model.available !== false)?.modelKey
          || '',
      )
      setResolution(next.defaults.resolution || '')
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : '加载视频模型失败'))
  }, [data.projectId])

  useEffect(() => {
    if (!activeShot) return
    const assets = activeShot.refs.map((ref) => ({ kind: kindToApi(ref.kind), name: ref.name }))
    setPrompt(formatSeedancePromptForEditor(extractSeedanceVideoPromptBody(activeShot.videoPrompt || activeShot.description || ''), assets))
    setRefs(activeShot.refs)
    setDuration(Math.max(4, Math.min(15, Math.round(activeShot.duration || 5))))
    setMessage(null); setError(null)
  }, [activeShot])

  const loadTasks = useCallback(async () => {
    if (!activeShot) { setTasks([]); return }
    const params = new URLSearchParams({ targetType: 'NovelPromotionPanel', targetId: activeShot.id, type: 'video_panel', limit: '30' })
    const response = await apiFetch(`/api/tasks?${params}`)
    if (!response.ok) return
    const payload = await response.json() as { tasks?: TaskItem[] }
    setTasks(Array.isArray(payload.tasks) ? payload.tasks : [])
  }, [activeShot])
  useEffect(() => { void loadTasks() }, [loadTasks])
  const shotIdsSignature = shots.map((shot) => shot.id).sort().join(',')
  const loadEpisodeActiveTasks = useCallback(async () => {
    const panelIds = new Set(shotIdsSignature.split(',').filter(Boolean))
    if (panelIds.size === 0) { setEpisodeActiveTasks([]); return }
    const params = new URLSearchParams({
      projectId: data.projectId,
      targetType: 'NovelPromotionPanel',
      limit: '200',
    })
    params.append('type', 'video_panel')
    params.append('type', 'lip_sync')
    params.append('status', 'queued')
    params.append('status', 'processing')
    const response = await apiFetch(`/api/tasks?${params}`)
    if (!response.ok) return
    const payload = await response.json() as { tasks?: TaskItem[] }
    setEpisodeActiveTasks((payload.tasks || []).filter((task) => task.targetId && panelIds.has(task.targetId)))
  }, [data.projectId, shotIdsSignature])
  useEffect(() => { void loadEpisodeActiveTasks() }, [loadEpisodeActiveTasks])
  const activeTask = tasks.find((task) => task.status === 'queued' || task.status === 'processing')
  const activeEpisodeTask = episodeActiveTasks[0]
  const readyVideoCount = shots.filter(shotVideoReady).length
  const reviewRefreshKey = `${episodeId}:${readyVideoCount}:${episodeActiveTasks.length}`
  const episodeReview = useEpisodeVideoReview({
    projectId: data.projectId,
    episodeId,
    refreshKey: reviewRefreshKey,
  })
  const reviewLocked = episodeReview.assignment?.status === 'pending_review'
    || episodeReview.assignment?.status === 'completed'
  const canEdit = roleCanEdit && !episodeReview.loading && !reviewLocked
  const reviewAnnotations = episodeReview.context?.annotations || []
  const openReviewAnnotations = reviewAnnotations.filter((annotation) => annotation.status === 'open')
  const segmentReviewAnnotations = activeShot
    ? reviewAnnotations.filter((annotation) => annotation.panelId === activeShot.id)
    : []
  const episodeReviewAnnotations = openReviewAnnotations.filter((annotation) => !annotation.panelId)
  const overallReviewNote = episodeReview.assignment?.status === 'rejected'
    ? episodeReview.assignment.lastReviewNote?.trim() || ''
    : ''
  useEffect(() => {
    if (!activeTask && !activeEpisodeTask) return
    const timer = window.setInterval(async () => {
      await Promise.all([loadTasks(), loadEpisodeActiveTasks(), loadShots(true)])
    }, 2500)
    return () => window.clearInterval(timer)
  }, [activeEpisodeTask, activeTask, loadEpisodeActiveTasks, loadShots, loadTasks])

  const currentModel = config?.videoModels.find((model) => model.modelKey === modelKey)
  const resolutions = useMemo(() => (currentModel?.options.resolution || []).map(String), [currentModel])
  const durations = useMemo(() => (currentModel?.options.duration || []).map(Number).filter(Number.isFinite), [currentModel])
  const boundVoiceNames = useMemo(() => {
    const referencedNames = refs
      .filter((ref) => ref.kind === '角色')
      .map((ref) => normalizedAssetName(ref.name))
      .filter(Boolean)
    return data.characters
      .filter((character) => Boolean(character.customVoiceUrl?.trim()))
      .filter((character) => {
        const name = normalizedAssetName(character.name)
        return referencedNames.some((reference) => reference === name || reference.includes(name) || name.includes(reference))
          || prompt.includes(`@${character.name}`)
      })
      .map((character) => character.name)
  }, [data.characters, prompt, refs])
  const supportsCharacterReferenceAudio = /^(?:nori::seedance2\.0$|ark::doubao-seedance-2-0|hfsy::sd-2-vip)/i.test(modelKey)
  const locksGeneratedAudio = boundVoiceNames.length > 0 && supportsCharacterReferenceAudio
  useEffect(() => {
    if (!currentModel) return
    setGenerateAudio(locksGeneratedAudio || currentModel.supportGenerateAudio)
  }, [currentModel, locksGeneratedAudio])
  useEffect(() => {
    if (resolutions.length > 0 && !resolutions.includes(resolution)) setResolution(resolutions[0])
    if (durations.length > 0 && !durations.includes(duration)) setDuration(durations[0])
  }, [duration, durations, resolution, resolutions])

  const savePrompt = async () => {
    if (!canEdit || !activeShot) return false
    setSaving(true); setError(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/panel`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ panelId: activeShot.id, videoPrompt: prompt }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存视频提示词失败'))
      setShots((current) => current.map((shot) => shot.id === activeShot.id ? { ...shot, videoPrompt: prompt } : shot))
      setMessage('视频提示词已保存。')
      return true
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : '保存视频提示词失败'); return false }
    finally { setSaving(false) }
  }

  const addMaterial = async (material: FrameosMaterialItem) => {
    if (!canEdit || !activeShot || !pickerKind) return
    setError(null)
    const response = await apiFetch(`/api/novel-promotion/${data.projectId}/panels/${activeShot.id}/materials`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: material.id, kind: kindToApi(pickerKind) }),
    })
    if (!response.ok) { setError(await readApiErrorMessage(response, '添加素材失败')); return }
    const payload = await response.json() as { assets?: Array<{ materialId?: string | null; kind: string; name: string; imageUrl: string }> }
    const next = (payload.assets || []).map((asset) => ({ materialId: asset.materialId, kind: apiToKind(asset.kind), name: asset.name, imageUrl: asset.imageUrl }))
    setRefs(next)
    setShots((current) => current.map((shot) => shot.id === activeShot.id ? { ...shot, refs: next } : shot))
  }

  const removeMaterial = async (materialId: string) => {
    if (!canEdit || !activeShot) return
    const response = await apiFetch(`/api/novel-promotion/${data.projectId}/panels/${activeShot.id}/materials?materialId=${encodeURIComponent(materialId)}`, { method: 'DELETE' })
    if (!response.ok) { setError(await readApiErrorMessage(response, '移除素材失败')); return }
    setRefs((current) => current.filter((ref) => ref.materialId !== materialId))
  }

  const generate = async () => {
    if (!canEdit || !activeShot || !modelKey) return
    if (!prompt.trim()) { setError('视频提示词不能为空。'); return }
    if (boundVoiceNames.length > 0 && !supportsCharacterReferenceAudio) {
      setError(`当前模型不支持角色参考音频。请切换到 Seedance 2.0 后生成，确保 @${boundVoiceNames.join('、@')} 的音色被注入。`)
      return
    }
    setGenerating(true); setError(null); setMessage(null)
    try {
      if (!await savePrompt()) return
      const generationOptions: Record<string, string | number | boolean> = { duration }
      if (resolution) generationOptions.resolution = resolution
      if (currentModel?.supportGenerateAudio || locksGeneratedAudio) {
        generationOptions.generateAudio = locksGeneratedAudio ? true : generateAudio
      }
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/generate-video`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboardId: activeShot.storyboardId,
          panelIndex: activeShot.panelIndex,
          videoModel: modelKey,
          customPrompt: stylePrompt.trim() ? `${prompt}\n\n画风描述：${stylePrompt.trim()}` : prompt,
          generationOptions,
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '提交视频生成失败'))
      setMessage('视频生成任务已提交；完成后会自动进入素材库。')
      await Promise.all([loadTasks(), loadEpisodeActiveTasks()])
    } catch (generateError) { setError(generateError instanceof Error ? generateError.message : '提交视频生成失败') }
    finally { setGenerating(false) }
  }

  const mentionAssets = useMemo(() => refs.map((ref) => ({ id: ref.materialId || `${ref.kind}:${ref.name}`, name: ref.name, imageUrl: ref.imageUrl })), [refs])
  const selectedMaterialIds = refs.map((ref) => ref.materialId).filter((id): id is string => Boolean(id))

  if (!episodeId || data.episodes.length === 0) return <div className="fos-loading">当前项目还没有可制作的分集。</div>

  const activeReviewSource = episodeReview.context?.sources.find((source) => source.panelId === activeShot?.id)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FosProductionModeTabs projectId={data.projectId} episodeId={episodeId} active="generate" />
      <div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-4 py-2.5">
        <span className="text-[12px] font-bold text-[var(--fos-text-3)]">剧集</span>
        <select className="fos-input h-8 max-w-[300px]" value={episodeId} onChange={(event) => setEpisodeId(event.target.value)}>
          {data.episodes.map((episode) => <option key={episode.id} value={episode.id}>E{episode.episodeNumber} {episode.name}</option>)}
        </select>
        <span className="fos-pill">{shots.length} 个 Segment</span>
        {loading ? <span className="text-[11px] text-[var(--fos-text-4)]">加载中…</span> : null}
      </div>

      {(overallReviewNote || episodeReviewAnnotations.length > 0) ? (
        <section className="mx-4 mt-3 rounded-[10px] border border-red-400/25 bg-red-500/10 px-4 py-3" aria-label="整集评审意见">
          <div className="flex items-center gap-2 text-[12px] font-bold text-red-200"><AppIcon name="alert" className="h-4 w-4" />整集评审意见</div>
          {overallReviewNote ? <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-white/85">{overallReviewNote}</p> : null}
          {episodeReviewAnnotations.map((annotation) => (
            <div key={annotation.id} className="mt-2 border-l-2 border-red-300/70 pl-3 text-[11px] text-white/80">
              <time className="mr-2 font-mono text-red-200">{formatVideoReviewTimecode(annotation.startMs)}–{formatVideoReviewTimecode(annotation.endMs)}</time>
              {annotation.note}
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '290px minmax(420px,1fr) 390px' }}>
        <aside className="min-h-0 overflow-y-auto border-r border-[var(--fos-border-soft)] p-3">
          <div className="mb-3 text-[14px] font-bold text-white">Segment 列表</div>
          <div className="space-y-2">
            {shots.map((shot) => {
              const active = shot.id === activeShot?.id
              const videoReady = shotVideoReady(shot)
              const feedbackCount = openReviewAnnotations.filter((annotation) => annotation.panelId === shot.id).length
              return (
                <button
                  key={shot.id}
                  type="button"
                  onClick={() => setActiveShotId(shot.id)}
                  className="w-full rounded-[10px] border p-3 text-left"
                  style={{ borderColor: active ? 'var(--fos-primary)' : 'var(--fos-border-mid)', background: active ? 'var(--fos-primary-soft)' : 'var(--fos-bg-2)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-[#8fa9ff]">{shot.scene} · Segment {String(shot.panelNumber ?? shot.panelIndex + 1).padStart(2, '0')}</span>
                    <span className={`text-[10px] font-bold ${videoReady ? 'text-[#62d99b]' : 'text-[var(--fos-text-4)]'}`}>{videoReady ? '已生成' : '待生成'}</span>
                  </div>
                  <div className="mt-1.5 truncate text-[13px] font-bold text-white">{shot.title}</div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--fos-text-4)]">
                    <span>{Math.round(shot.duration || 5)}s · {shot.refs.length} 项素材</span>
                    {feedbackCount > 0 ? <span className="rounded bg-red-500/20 px-1.5 py-0.5 font-bold text-red-200">{feedbackCount} 条意见</span> : null}
                  </div>
                </button>
              )
            })}
            {!loading && shots.length === 0 ? <div className="py-12 text-center text-[12px] text-[var(--fos-text-4)]">本集还没有 Segment，请先完成分镜设计。</div> : null}
          </div>
        </aside>

        <main className="min-w-0 overflow-y-auto border-r border-[var(--fos-border-soft)] p-5">
          {activeShot ? (
            <>
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-[16px] font-bold text-white">{activeShot.scene} · Segment {String(activeShot.panelNumber ?? activeShot.panelIndex + 1).padStart(2, '0')}</h2>
                  <p className="mt-1 text-[11px] text-[var(--fos-text-4)]">{activeShot.title} · {activeTask ? `生成中 ${activeTask.progress}%` : shotVideoReady(activeShot) ? '视频可用' : '等待生成'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => void loadShots(true)}><AppIcon name="refresh" className="h-3.5 w-3.5" />刷新</button>
                </div>
              </div>
              <div className="relative mb-4 flex aspect-video min-h-[360px] items-center justify-center overflow-hidden rounded-[12px] border border-[var(--fos-border-mid)] bg-black"><ShotPreview shot={activeShot} /></div>
              <div className="flex gap-5 border-b border-[var(--fos-border-soft)]">
                {([
                  ['history', '生成历史'],
                  ['review', `评审意见${segmentReviewAnnotations.length ? ` · ${segmentReviewAnnotations.length}` : ''}`],
                ] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setCenterTab(key)} className="relative h-9 text-[13px] font-bold" style={{ color: centerTab === key ? 'var(--fos-primary)' : 'var(--fos-text-2)' }}>
                    {label}{centerTab === key ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--fos-primary)]" /> : null}
                  </button>
                ))}
              </div>
              {centerTab === 'history' ? (
                <div className="space-y-2 py-4">
                  {tasks.map((task) => <div key={task.id} className="flex items-center justify-between rounded-lg border border-[var(--fos-border-soft)] px-3 py-2 text-[11px]"><span className="text-[var(--fos-text-3)]">{new Date(task.createdAt).toLocaleString('zh-CN', { hour12: false })}</span><span className={task.status === 'completed' ? 'text-[#62d99b]' : task.status === 'failed' ? 'text-red-300' : 'text-[#8fa9ff]'}>{task.status === 'completed' ? '完成' : task.status === 'failed' ? `失败 · ${task.errorMessage || ''}` : `${task.status} · ${task.progress}%`}</span></div>)}
                  {tasks.length === 0 ? <div className="py-8 text-center text-[12px] text-[var(--fos-text-4)]">暂无生成记录</div> : null}
                </div>
              ) : null}
              {centerTab === 'review' ? (
                <div className="space-y-3 py-4">
                  {segmentReviewAnnotations.map((annotation) => {
                    const offset = activeReviewSource?.startMs || 0
                    return (
                      <article key={annotation.id} className={`rounded-lg border p-3 ${annotation.status === 'open' ? 'border-red-400/30 bg-red-500/10' : 'border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)]'}`}>
                        <div className="flex items-center justify-between gap-3"><time className="font-mono text-[11px] text-red-200">Segment {formatVideoReviewTimecode(Math.max(0, annotation.startMs - offset))}–{formatVideoReviewTimecode(Math.max(0, annotation.endMs - offset))}</time><span className="text-[10px] font-bold text-[var(--fos-text-4)]">{annotation.status === 'open' ? '待修改' : '历史意见'}</span></div>
                        <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-white/85">{annotation.note}</p>
                      </article>
                    )
                  })}
                  {segmentReviewAnnotations.length === 0 ? <div className="py-8 text-center text-[12px] text-[var(--fos-text-4)]">当前 Segment 暂无评审意见</div> : null}
                </div>
              ) : null}
            </>
          ) : <div className="fos-loading">请选择 Segment</div>}
        </main>

        <aside className="min-h-0 overflow-y-auto p-4">
          {activeShot ? (
            <>
              <h3 className="mb-2 text-[14px] font-bold text-white">参考资产</h3>
              <p className="mb-3 text-[11px] text-[var(--fos-text-4)]">参考图 {refs.filter((ref) => ref.imageUrl).length}/9 · {canEdit ? '从素材库选择，也可在选择器中本地命名上传' : '当前账号仅可查看'}</p>
              {(['角色', '物品', '环境'] as const).map((kind) => (
                <div key={kind} className="mb-3">
                  <div className="mb-2 flex items-center justify-between"><span className="text-[12px] font-bold text-white">{kind}</span><button type="button" className="fos-btn fos-btn-soft fos-btn-sm" disabled={!canEdit} onClick={() => setPickerKind(kind)}><AppIcon name="plus" className="h-3 w-3" />{canEdit ? '添加' : '只读'}</button></div>
                  <div className="flex flex-wrap gap-2">{refs.filter((ref) => ref.kind === kind).map((ref) => {
                    const src = toDisplayImageUrl(ref.imageUrl)
                    return <div key={`${ref.materialId || ''}:${ref.name}`} className="relative h-[70px] w-[70px] overflow-hidden rounded-lg border border-[var(--fos-border-mid)] bg-black/35">{src ? <MediaImage src={src} alt={ref.name} fill sizes="70px" style={{ objectFit: 'cover' }} /> : <AppIcon name={kind === '角色' ? 'user' : kind === '物品' ? 'package' : 'imageLandscape'} className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-white/20" />}<span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/75 px-1 text-[9px] text-white">{ref.name}</span>{canEdit && ref.materialId ? <button type="button" className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/75 text-white" onClick={() => void removeMaterial(ref.materialId!)}><AppIcon name="close" className="h-2.5 w-2.5" /></button> : null}</div>
                  })}</div>
                </div>
              ))}

              <div className="my-4 h-px bg-[var(--fos-border-soft)]" />
              <h3 className="mb-3 text-[14px] font-bold text-white">模型配置</h3>
              <div className="grid grid-cols-3 gap-2">
                <label><span className="mb-1 block text-[10px] text-[var(--fos-text-4)]">视频模型</span><select className="fos-input h-8 text-[11px]" value={modelKey} disabled={!canEdit || !(config?.videoModels || []).some((model) => model.available !== false)} onChange={(event) => setModelKey(event.target.value)}>{!modelKey ? <option value="">暂无已接入模型</option> : null}{(config?.videoModels || []).map((model) => <option key={model.modelKey} value={model.modelKey} disabled={model.available === false}>{modelOptionLabel(model)}{model.available === false ? ' · 未接入' : ''}</option>)}</select></label>
                <label><span className="mb-1 block text-[10px] text-[var(--fos-text-4)]">分辨率</span><select className="fos-input h-8 text-[11px]" value={resolution} disabled={!canEdit} onChange={(event) => setResolution(event.target.value)}>{resolutions.length ? resolutions.map((item) => <option key={item}>{item}</option>) : <option value="">默认</option>}</select></label>
                <label><span className="mb-1 block text-[10px] text-[var(--fos-text-4)]">视频秒数</span><select className="fos-input h-8 text-[11px]" value={duration} disabled={!canEdit} onChange={(event) => setDuration(Number(event.target.value))}>{(durations.length ? durations : [4, 5, 6, 8, 10, 12, 15]).map((item) => <option key={item} value={item}>{item}s</option>)}</select></label>
              </div>
              {currentModel?.supportGenerateAudio || locksGeneratedAudio ? <label className="mt-3 flex items-center gap-2 text-[11px] text-[var(--fos-text-3)]"><input type="checkbox" checked={generateAudio} disabled={!canEdit || locksGeneratedAudio} onChange={(event) => setGenerateAudio(event.target.checked)} className="accent-[var(--fos-primary)]" />{locksGeneratedAudio ? `已自动注入角色音色：@${boundVoiceNames.join('、@')}` : '同步生成声音'}</label> : null}
              {boundVoiceNames.length > 0 && !supportsCharacterReferenceAudio ? <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[.08] px-3 py-2 text-[10px] leading-5 text-amber-200">当前模型不会接收角色参考音频，请切换为 Seedance 2.0。</div> : null}

              <div className="mt-4 rounded-[10px] border border-blue-400/25 bg-blue-500/[.08] p-3">
                <div className="flex items-center justify-between text-[11px]"><span className="font-bold text-white">下一步 · 剪辑</span><strong className="text-[#8fa9ff]">{readyVideoCount} / {shots.length} 个 Segment 可用</strong></div>
                <p className="mt-1.5 text-[10px] leading-5 text-[var(--fos-text-3)]">选择需要的 Segment 进入剪辑时间线；剪辑保存后即可提交全集评审，无需等待未采用的 Segment。</p>
                <Link href={{ pathname: `/workflow/${data.projectId}/workbench-premium2/production/timeline`, query: { episode_id: episodeId } }} className="fos-btn fos-btn-primary mt-2.5 w-full"><AppIcon name="edit" className="h-3.5 w-3.5" />进入剪辑与提交评审</Link>
              </div>

              <div className="mt-4 flex items-center justify-between"><h3 className="text-[14px] font-bold text-white">视频提示词</h3><button type="button" className="text-[11px] font-bold text-[#8fa9ff]" disabled={!canEdit || saving} onClick={() => void savePrompt()}>{canEdit ? saving ? '保存中…' : '保存' : '只读'}</button></div>
              <MentionPromptEditor value={prompt} assets={mentionAssets} onChange={setPrompt} minHeight={220} placeholder="输入视频提示词；输入 @ 可引用右侧参考资产" readOnly={!canEdit} />
              <div className="mt-3 text-[12px] font-bold text-white">画风描述</div>
              <textarea className="fos-textarea mt-2" style={{ minHeight: 70 }} value={stylePrompt} readOnly={!canEdit} onChange={(event) => setStylePrompt(event.target.value)} />
              <button type="button" className="fos-btn fos-btn-primary mt-4 w-full" disabled={!canEdit || generating || Boolean(activeTask) || !modelKey || currentModel?.available === false} onClick={() => void generate()}>{reviewLocked ? episodeReview.assignment?.status === 'completed' ? '本集已通过 · 已锁定' : '本集审核中 · 已锁定' : !canEdit ? '只读 · 分镜师可生成视频' : activeTask ? `生成中 ${activeTask.progress}%` : generating ? '提交中…' : '生成视频'}</button>
              {error || episodeReview.error ? <div className="mt-3 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{error || episodeReview.error}</div> : null}
              {message ? <div className="mt-3 rounded-lg border border-blue-400/25 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-200">{message}</div> : null}
            </>
          ) : null}
        </aside>
      </div>
      {canEdit && pickerKind && activeShot ? <MaterialPickerDialog projectId={data.projectId} type="image" title={`添加${pickerKind}素材`} selectedIds={selectedMaterialIds} maxSelected={9} onSelect={(material) => void addMaterial(material)} onClose={() => setPickerKind(null)} /> : null}
    </div>
  )
}
