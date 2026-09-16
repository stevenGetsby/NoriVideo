'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { logError } from '@/lib/logging/core'
import { resolveTaskResponse } from '@/lib/task/client'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { MediaImage } from '@/components/media/MediaImage'
import type { FosProjectData, FosAsset, FosAssetVariant } from '../useFosProject'
import { MaterialPickerDialog } from '../materials/MaterialPickerDialog'
import type { FrameosMaterialItem } from '../materials/contracts'
import {
  AddAssetDialog,
  AddCharacterVariantDialog,
  AssetTabs,
  ImageZoom,
  type AssetTab,
} from './FosAssetShared'
import { useAccountBalance } from '@/hooks/common/useAccountBalance'

const PAGE_META: Record<Exclude<AssetTab, 'timbre'>, {
  title: string
  listTitle: string
  bgTitle: string
  promptTitle: string
  promptHint: string
  variantTitle: string
  variantPromptTitle: string
  mediaTitle: string
}> = {
  characters: {
    title: '角色资产设定',
    listTitle: '角色列表',
    bgTitle: '角色背景',
    promptTitle: '标准角色生图提示词',
    promptHint: '给文生图模型的格式化主形象提示词，用于生成角色设定主图。',
    variantTitle: '变体',
    variantPromptTitle: '图生图编辑提示词',
    mediaTitle: '形象设定图',
  },
  items: {
    title: '物品资产设定',
    listTitle: '物品列表',
    bgTitle: '物品背景',
    promptTitle: '标准物品生图提示词',
    promptHint: '给文生图模型的格式化物品提示词。',
    variantTitle: '变体',
    variantPromptTitle: '变体生图提示词',
    mediaTitle: '物品设定图',
  },
  environments: {
    title: '环境资产设定',
    listTitle: '环境列表',
    bgTitle: '环境背景',
    promptTitle: '标准环境生图提示词',
    promptHint: '给文生图模型的格式化环境提示词。',
    variantTitle: '变体',
    variantPromptTitle: '变体生图提示词',
    mediaTitle: '环境设定图',
  },
}

function useAssetList(data: FosProjectData, tab: Exclude<AssetTab, 'timbre'>): FosAsset[] {
  return tab === 'characters' ? data.characters : tab === 'items' ? data.items : data.environments
}

type AssetImageTarget = {
  key: string
  asset: FosAsset
  label: string
  prompt: string
  imageUrl: string | null
  appearanceId?: string | null
  imageIndex: number
  taskTargetType: 'CharacterAppearance' | 'LocationImage'
  taskTargetId: string
}

type ImageHistoryTask = {
  id: string
  type: string
  targetType: string
  targetId: string
  status: string
  progress: number
  payload?: unknown
  result?: unknown
  billingInfo?: unknown
  errorMessage?: string | null
  createdAt: string
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function imageTargetsForAsset(
  tab: Exclude<AssetTab, 'timbre'>,
  asset: FosAsset,
): AssetImageTarget[] {
  if (tab === 'characters') {
    const mainTargetId = asset.mainAppearanceId || asset.id
    const targets: AssetImageTarget[] = [{
      key: `${asset.id}:appearance:${mainTargetId}:0`,
      asset,
      label: `${asset.name} · 主图`,
      prompt: asset.prompt || '',
      imageUrl: asset.imageUrl,
      appearanceId: asset.mainAppearanceId,
      imageIndex: 0,
      taskTargetType: 'CharacterAppearance',
      taskTargetId: mainTargetId,
    }]
    for (const [index, variant] of (asset.variants || []).entries()) {
      if (!variant.appearanceId) continue
      targets.push({
        key: `${asset.id}:appearance:${variant.appearanceId}:0`,
        asset,
        label: `${asset.name} · ${variant.label}`,
        prompt: variant.fullPrompt || variant.description || '',
        imageUrl: variant.imageUrl || null,
        appearanceId: variant.appearanceId,
        imageIndex: 0,
        taskTargetType: 'CharacterAppearance',
        taskTargetId: variant.appearanceId,
      })
      if (!variant.id) targets[targets.length - 1].key += `:${index}`
    }
    return targets
  }

  const targets: AssetImageTarget[] = [{
    key: `${asset.id}:image:0`,
    asset,
    label: `${asset.name} · 主图`,
    prompt: asset.prompt || '',
    imageUrl: asset.imageUrl,
    imageIndex: 0,
    taskTargetType: 'LocationImage',
    taskTargetId: asset.id,
  }]
  for (const [index, variant] of (asset.variants || []).entries()) {
    const imageIndex = variant.imageIndex ?? index + 1
    if (imageIndex === 0) continue
    targets.push({
      key: `${asset.id}:image:${imageIndex}`,
      asset,
      label: `${asset.name} · ${variant.label}`,
      prompt: variant.fullPrompt || variant.description || '',
      imageUrl: variant.imageUrl || null,
      imageIndex,
      taskTargetType: 'LocationImage',
      taskTargetId: asset.id,
    })
  }
  return targets
}

function historyImageUrl(task: ImageHistoryTask): string | null {
  const result = toRecord(task.result)
  const direct = readText(result.imageUrl)
  if (direct) return direct
  const requestedIndex = Number(toRecord(task.payload).imageIndex ?? 0)
  const images = Array.isArray(result.images) ? result.images : []
  for (const entry of images) {
    const row = toRecord(entry)
    if (Number(row.imageIndex) === requestedIndex) return readText(row.imageUrl)
  }
  return null
}

function historyModel(task: ImageHistoryTask): string {
  const billing = toRecord(task.billingInfo)
  const payload = toRecord(task.payload)
  return readText(billing.model)
    || readText(payload.imageModel)
    || readText(payload.model)
    || (task.type === 'image_character' ? '角色生图模型' : '资产生图模型')
}

function HistoryPanel({
  projectId,
  targets,
  refreshKey,
}: {
  projectId: string
  targets: AssetImageTarget[]
  refreshKey: number
}) {
  const [rows, setRows] = useState<ImageHistoryTask[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showFailed, setShowFailed] = useState(true)
  const targetSignature = targets
    .map((target) => `${target.taskTargetType}:${target.taskTargetId}`)
    .sort()
    .join('|')

  const loadHistory = useCallback(async () => {
    if (targets.length === 0) {
      setRows([])
      setLoading(false)
      return
    }
    setLoadError(null)
    try {
      const uniqueByKey = new Map<string, AssetImageTarget>()
      for (const target of targets) {
        uniqueByKey.set(`${target.taskTargetType}:${target.taskTargetId}`, target)
      }
      const uniqueTargets = Array.from(uniqueByKey.values())
      const taskGroups = await Promise.all(uniqueTargets.map(async (target) => {
        const search = new URLSearchParams({
          projectId,
          targetType: target.taskTargetType,
          targetId: target.taskTargetId,
          limit: '40',
        })
        search.append('type', target.taskTargetType === 'CharacterAppearance' ? 'image_character' : 'image_location')
        const response = await apiFetch(`/api/tasks?${search.toString()}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载生图历史失败'))
        const payload = await response.json() as { tasks?: ImageHistoryTask[] }
        return payload.tasks || []
      }))
      const deduped = new Map<string, ImageHistoryTask>()
      taskGroups.flat().forEach((task) => deduped.set(task.id, task))
      setRows(Array.from(deduped.values()).sort((a, b) => (
        Date.parse(b.createdAt) - Date.parse(a.createdAt)
      )))
    } catch (historyError) {
      setLoadError(historyError instanceof Error ? historyError.message : '加载生图历史失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, targetSignature]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true)
    void loadHistory()
    const timer = window.setInterval(() => void loadHistory(), 3_000)
    return () => window.clearInterval(timer)
  }, [loadHistory, refreshKey])

  const targetByHistoryKey = new Map<string, AssetImageTarget>()
  for (const target of targets) {
    targetByHistoryKey.set(`${target.taskTargetId}:${target.imageIndex}`, target)
    if (!targetByHistoryKey.has(target.taskTargetId)) targetByHistoryKey.set(target.taskTargetId, target)
  }
  const visibleRows = showFailed ? rows : rows.filter((row) => row.status !== 'failed')

  return (
    <div className="fos-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--fos-border-soft)] px-4 py-2.5">
        <h4 className="text-[13px] font-bold text-white">生图历史</h4>
        <button type="button" className="text-[12px] font-bold text-[#8fa9ff]" onClick={() => setShowFailed((value) => !value)}>
          {showFailed ? '隐藏失败记录' : '展示失败记录'}
        </button>
      </div>
      <div className="divide-y divide-[var(--fos-border-soft)]">
        {visibleRows.map((task) => {
          const payload = toRecord(task.payload)
          const target = targetByHistoryKey.get(`${task.targetId}:${Number(payload.imageIndex ?? 0)}`)
            || targetByHistoryKey.get(task.targetId)
          const imageUrl = toDisplayImageUrl(historyImageUrl(task))
          const completed = task.status === 'completed'
          const failed = task.status === 'failed'
          const status = completed ? '已完成' : failed ? '生成失败' : task.status === 'processing' ? `生成中 ${task.progress}%` : '排队中'
          return (
            <div key={task.id} className="grid items-center gap-3 px-4 py-2.5 text-[12px]" style={{ gridTemplateColumns: '48px 1fr 72px' }}>
              <div className="relative h-12 w-12 overflow-hidden rounded-md border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)]">
                {imageUrl ? <MediaImage src={imageUrl} alt={target?.label || '历史生成图片'} fill sizes="48px" style={{ objectFit: 'cover' }} /> : <AppIcon name={failed ? 'alert' : 'imageLandscape'} className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-white/20" />}
              </div>
              <div className="min-w-0">
                <div className="truncate font-bold text-[var(--fos-text-2)]">{target?.label || '资产图片'}</div>
                <div className="truncate text-[var(--fos-text-4)]">{historyModel(task)} · {new Date(task.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
                {failed && task.errorMessage ? <div className="mt-0.5 line-clamp-1 text-[#ff8e8e]" title={task.errorMessage}>{task.errorMessage}</div> : null}
              </div>
              <div className={failed ? 'text-right font-bold text-[#ff7777]' : completed ? 'text-right font-bold text-[#5bd08f]' : 'text-right font-bold text-[#8fa9ff]'}>{status}</div>
            </div>
          )
        })}
        {loading ? <div className="px-4 py-6 text-center text-[12px] text-[var(--fos-text-4)]">正在读取真实任务记录…</div> : null}
        {!loading && loadError ? <div className="px-4 py-4 text-[12px] text-[#ff8e8e]">{loadError}</div> : null}
        {!loading && !loadError && visibleRows.length === 0 ? <div className="px-4 py-6 text-center text-[12px] text-[var(--fos-text-4)]">暂无生图记录</div> : null}
      </div>
    </div>
  )
}

function getVariantDisplayText(description: string, changeText?: string | null): string {
  if (changeText?.trim()) return changeText.trim()
  const marker = '【变体变化】'
  const index = description.indexOf(marker)
  const body = index >= 0 ? description.slice(index + marker.length).trim() : description
  const visualMarker = '视觉档案：'
  const visualIndex = body.indexOf(visualMarker)
  if (visualIndex >= 0) {
    const lines = body.slice(visualIndex + visualMarker.length).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const changeLines: string[] = []
    for (const line of lines) {
      if (/^(世界背景|统一画风|近代|民国|院线|真人实拍)/.test(line)) break
      if (/^(主体|面部|服装|配饰)[：:]/.test(line)) changeLines.push(line)
    }
    if (changeLines.length > 0) return changeLines.join('\n')
  }
  return body
}

function AssetPreview({ kind, imageUrl, alt }: { kind: AssetTab; imageUrl?: string | null; alt: string }) {
  const src = toDisplayImageUrl(imageUrl)
  if (!src) {
    const mediaName = kind === 'characters' ? '形象设定图' : kind === 'items' ? '物品设定图' : '环境设定图'
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#050506] px-6 text-center" data-testid="asset-image-empty-state">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[.035] text-white/25"><AppIcon name="imageLandscape" className="h-5 w-5" /></span>
        <strong className="mt-3 text-[13px] font-bold text-white/65">{mediaName}还未生成</strong>
        <span className="mt-1 text-[11px] text-white/30">可生成图片，或从素材库与本地导入</span>
      </div>
    )
  }
  return (
    <div className="relative h-full w-full bg-[#f4f4f4]">
      <MediaImage
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 1280px) 50vw, 640px"
        style={{ objectFit: 'contain' }}
      />
    </div>
  )
}

function AssetImageModifyDialog({
  target,
  submitting,
  onSubmit,
  onClose,
}: {
  target: AssetImageTarget
  submitting: boolean
  onSubmit: (prompt: string) => void
  onClose: () => void
}) {
  const [prompt, setPrompt] = useState('')
  const src = toDisplayImageUrl(target.imageUrl)
  return (
    <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose() }}>
      <section role="dialog" aria-modal="true" aria-label={`AI 修改 ${target.label}`} className="fos-dialog overflow-hidden" style={{ width: 'min(760px, calc(100vw - 24px))', maxWidth: 760 }}>
        <div className="fos-dialog-head">
          <div><div className="fos-dialog-title">AI 修改图片</div><div className="mt-1 text-[11px] text-[var(--fos-text-4)]">{target.label} · 图生图任务</div></div>
          <button type="button" className="fos-dialog-x" aria-label="关闭 AI 修改" disabled={submitting} onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="fos-dialog-body grid gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
          <div>
            <div className="mb-2 text-[12px] font-bold text-[var(--fos-text-3)]">基础参考图</div>
            <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] border border-[rgba(111,140,255,.32)] bg-black">
              {src ? <MediaImage src={src} alt={target.label} fill sizes="240px" style={{ objectFit: 'contain' }} /> : null}
              <span className="absolute bottom-2 left-2 rounded-md bg-black/75 px-2 py-1 text-[10px] font-bold text-[#a9bdff]">自动作为 Reference 1</span>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-[var(--fos-text-4)]">系统会把当前生成图作为首张参考图，保留主体身份与构图连续性。</p>
          </div>
          <label className="block"><span className="mb-2 block text-[12px] font-bold text-white">修改要求</span><textarea className="fos-textarea" style={{ minHeight: 220 }} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：保持人物五官、发型与构图不变，将服装改为深蓝色西装，增加雨水打湿质感。" autoFocus /><span className="mt-2 block text-[11px] leading-5 text-[var(--fos-text-4)]">只描述需要改变的部分；未提及的主体特征会尽量保持。</span></label>
        </div>
        <div className="fos-dialog-foot"><button type="button" className="fos-btn fos-btn-ghost" disabled={submitting} onClick={onClose}>取消</button><button type="button" className="fos-btn fos-btn-primary" disabled={submitting || !prompt.trim()} onClick={() => onSubmit(prompt.trim())}>{submitting ? '正在提交图生图任务…' : '开始 AI 修改'}</button></div>
      </section>
    </div>
  )
}

export function FosAssetSetting({ data, tab }: { data: FosProjectData; tab: Exclude<AssetTab, 'timbre'> }) {
  const { data: session } = useSession()
  const { generationAllowed } = useAccountBalance()
  const canEdit = hasAccountPermissions({ role: session?.user?.role, permissions: session?.user?.permissions }, ['assetWrite'])
  const meta = PAGE_META[tab]
  const list = useAssetList(data, tab)
  const [activeId, setActiveId] = useState(list[0]?.id ?? '')
  const [showAdd, setShowAdd] = useState(false)
  const [showAddVariant, setShowAddVariant] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [generatingKeys, setGeneratingKeys] = useState<Set<string>>(() => new Set())
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set())
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({})
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [extracting, setExtracting] = useState(false)
  const [extractionProgress, setExtractionProgress] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingVariantId, setDeletingVariantId] = useState<string | null>(null)
  const [modifyTarget, setModifyTarget] = useState<AssetImageTarget | null>(null)
  const [importTarget, setImportTarget] = useState<AssetImageTarget | null>(null)
  const [modifyingKey, setModifyingKey] = useState<string | null>(null)
  const [importingKey, setImportingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refreshTimers = useRef<number[]>([])
  const active = list.find((a) => a.id === activeId) ?? list[0]
  const count = list.length
  const allImageTargets = useMemo(() => list.flatMap((asset) => imageTargetsForAsset(tab, asset)), [list, tab])
  const activeImageTargets = useMemo(() => active ? imageTargetsForAsset(tab, active) : [], [active, tab])
  const mainImageTarget = activeImageTargets[0] || null
  const variantImageTargets = activeImageTargets.slice(1)
  const canGenerate = allImageTargets.length > 0
  const canExtract = data.episodes.some((episode) => Boolean(episode.novelText?.trim()))

  useEffect(() => {
    return () => {
      refreshTimers.current.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  useEffect(() => {
    if (list.length === 0) {
      if (activeId) setActiveId('')
      return
    }
    if (!list.some((asset) => asset.id === activeId)) {
      setActiveId(list[0].id)
    }
  }, [activeId, list])

  const scheduleImageRefreshes = () => {
    refreshTimers.current.forEach((timer) => window.clearTimeout(timer))
    data.refetch()
    refreshTimers.current = [5_000, 15_000, 30_000, 60_000, 90_000].map((delay) => (
      window.setTimeout(data.refetch, delay)
    ))
  }

  const submitSingleImageTask = async (target: AssetImageTarget) => {
    const isCharacter = tab === 'characters'
    const res = await apiFetch(`/api/novel-promotion/${data.projectId}/regenerate-single-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locale: 'zh',
        type: isCharacter ? 'character' : tab === 'items' ? 'prop' : 'location',
        id: target.asset.id,
        ...(isCharacter && target.appearanceId ? { appearanceId: target.appearanceId } : {}),
        imageIndex: target.imageIndex,
      }),
    })
    if (!res.ok) throw new Error(await readApiErrorMessage(res, '提交生图任务失败'))
  }

  const updateKeySet = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    key: string,
    enabled: boolean,
  ) => {
    setter((current) => {
      const next = new Set(current)
      if (enabled) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const saveImagePrompt = async (target: AssetImageTarget, force = false) => {
    const draft = promptDrafts[target.key]
    if (!force && draft === undefined) return false
    const description = (draft ?? target.prompt).trim()
    if (!description) throw new Error(`${target.label}的生图提示词不能为空`)
    if (tab === 'characters' && !target.appearanceId) {
      throw new Error(`${target.label}缺少形象记录，请重新解析资产后再试`)
    }

    const response = tab === 'characters'
      ? await apiFetch(`/api/novel-promotion/${data.projectId}/character/appearance`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characterId: target.asset.id,
            appearanceId: target.appearanceId,
            description,
            descriptionIndex: 0,
          }),
        })
      : await apiFetch(`/api/novel-promotion/${data.projectId}/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(tab === 'items' ? { propId: target.asset.id } : { locationId: target.asset.id }),
            imageIndex: target.imageIndex,
            description,
          }),
        })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '保存生图提示词失败'))
    setPromptDrafts((current) => ({ ...current, [target.key]: description }))
    return true
  }

  const handleSavePrompt = async (target: AssetImageTarget) => {
    if (!canEdit || savingKeys.has(target.key)) return
    updateKeySet(setSavingKeys, target.key, true)
    setError(null)
    setNotice(null)
    try {
      await saveImagePrompt(target, true)
      setNotice(`已保存「${target.label}」的生图提示词。`)
      data.refetch()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存生图提示词失败')
    } finally {
      updateKeySet(setSavingKeys, target.key, false)
    }
  }

  const handleGenerateOne = async (target: AssetImageTarget) => {
    if (!generationAllowed) { setError('积分不足，无法生成'); return }
    if (!canEdit || generatingAll || generatingKeys.has(target.key)) return
    updateKeySet(setGeneratingKeys, target.key, true)
    setError(null)
    setNotice(null)
    try {
      await saveImagePrompt(target)
      await submitSingleImageTask(target)
      setNotice(`已提交「${target.label}」生图任务，可在生图历史中查看实时状态。`)
      setHistoryRefreshKey((value) => value + 1)
      scheduleImageRefreshes()
    } catch (err) {
      logError('[FosAssetSetting] 单张资产生图失败', err)
      setError(err instanceof Error ? err.message : '提交生图任务失败')
    } finally {
      updateKeySet(setGeneratingKeys, target.key, false)
    }
  }

  const handleModifyImage = async (target: AssetImageTarget, modifyPrompt: string) => {
    if (!canEdit || !target.imageUrl || modifyingKey) return
    setModifyingKey(target.key)
    setError(null)
    setNotice(null)
    try {
      const kind = tab === 'characters' ? 'character' : tab === 'items' ? 'prop' : 'location'
      const response = await apiFetch(`/api/assets/${target.asset.id}/modify-render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'project',
          projectId: data.projectId,
          kind,
          modifyPrompt,
          imageIndex: target.imageIndex,
          ...(target.appearanceId ? { appearanceId: target.appearanceId } : {}),
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '提交 AI 修改任务失败'))
      setModifyTarget(null)
      setNotice(`已提交「${target.label}」图生图修改任务；当前图片会作为首张参考图。`)
      setHistoryRefreshKey((value) => value + 1)
      scheduleImageRefreshes()
    } catch (modifyError) {
      setError(modifyError instanceof Error ? modifyError.message : '提交 AI 修改任务失败')
    } finally {
      setModifyingKey(null)
    }
  }

  const handleImportMaterial = async (target: AssetImageTarget, material: FrameosMaterialItem) => {
    if (!canEdit || importingKey) return
    setImportingKey(target.key)
    setImportTarget(null)
    setError(null)
    setNotice(null)
    try {
      const kind = tab === 'characters' ? 'character' : tab === 'items' ? 'prop' : 'location'
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/import-asset-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          assetId: target.asset.id,
          appearanceId: target.appearanceId,
          imageIndex: target.imageIndex,
          materialId: material.id,
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '导入素材图失败'))
      setNotice(`已将素材「${material.title || '未命名图片'}」导入到「${target.label}」。`)
      data.refetch()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '导入素材图失败')
    } finally {
      setImportingKey(null)
    }
  }

  const handleGenerateAll = async () => {
    if (!generationAllowed) { setError('积分不足，无法生成'); return }
    if (!canEdit || !canGenerate || generatingAll || generatingKeys.size > 0) return
    setGeneratingAll(true)
    setError(null)
    setNotice(null)
    let submitted = 0
    const failures: string[] = []
    try {
      for (let offset = 0; offset < allImageTargets.length; offset += 3) {
        const batch = allImageTargets.slice(offset, offset + 3)
        await Promise.all(batch.map(async (target) => {
          try {
            await saveImagePrompt(target)
            await submitSingleImageTask(target)
            submitted += 1
          } catch (batchError) {
            const message = batchError instanceof Error ? batchError.message : '提交失败'
            failures.push(`${target.label}：${message}`)
          }
        }))
      }
      setHistoryRefreshKey((value) => value + 1)
      scheduleImageRefreshes()
      if (failures.length > 0) {
        setError(`已提交 ${submitted}/${allImageTargets.length} 张；${failures.slice(0, 3).join('；')}${failures.length > 3 ? `；另有 ${failures.length - 3} 张失败` : ''}`)
      } else {
        const kindLabel = tab === 'characters' ? '角色主图和变体图' : tab === 'items' ? '物品图片' : '环境图片'
        setNotice(`已提交全部 ${allImageTargets.length} 张${kindLabel}生成任务。`)
      }
    } finally {
      setGeneratingAll(false)
    }
  }

  const handleExtractAssets = async () => {
    if (!canEdit || !canExtract || extracting) return
    if (data.characters.length + data.items.length + data.environments.length > 0) {
      const confirmed = window.confirm('重新解析会替换当前项目的角色、物品和环境资产，已有资产设定图也可能被移除。确定继续吗？')
      if (!confirmed) return
    }
    setExtracting(true)
    setError(null)
    setNotice(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/asset-extraction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ async: true, persist: true, clearExisting: true }),
      })
      const payload = await resolveTaskResponse<{
        assets?: { characters?: number; environments?: number; props?: number }
      }>(response, {
        onTaskUpdate: (task) => setExtractionProgress(task.progress ?? null),
      })
      const counts = payload.assets
      setNotice(counts
        ? `资产解析完成：${counts.characters || 0} 个角色、${counts.environments || 0} 个环境、${counts.props || 0} 个物品。`
        : '资产解析完成。')
      data.refetch()
    } catch (err) {
      logError('[FosAssetSetting] 资产解析失败', err)
      setError(err instanceof Error ? err.message : '资产解析失败')
    } finally {
      setExtracting(false)
      setExtractionProgress(null)
    }
  }

  const handleDeleteAsset = async (asset: FosAsset) => {
    if (!canEdit || deletingId) return
    const kindLabel = tab === 'characters' ? '角色' : tab === 'items' ? '物品' : '环境'
    const cascadeHint = tab === 'characters' ? '该角色的主形象、变体和音色绑定会一并移除。' : '该资产的全部设定图会一并移除。'
    const confirmed = window.confirm(`确定删除${kindLabel}「${asset.name}」吗？${cascadeHint}`)
    if (!confirmed) return

    setDeletingId(asset.id)
    setError(null)
    setNotice(null)
    try {
      const endpoint = tab === 'characters' ? 'character' : 'location'
      const res = await apiFetch(`/api/novel-promotion/${data.projectId}/${endpoint}?id=${encodeURIComponent(asset.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, `删除${kindLabel}失败`))
      if (asset.id === activeId) {
        const next = list.find((item) => item.id !== asset.id)
        setActiveId(next?.id ?? '')
      }
      setNotice(`已删除${kindLabel}「${asset.name}」。`)
      data.refetch()
    } catch (err) {
      logError(`[FosAssetSetting] 删除${kindLabel}失败`, err)
      setError(err instanceof Error ? err.message : `删除${kindLabel}失败`)
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeleteCharacterVariant = async (variant: FosAssetVariant) => {
    const appearanceId = variant.appearanceId?.trim() || ''
    if (!canEdit || tab !== 'characters' || !active || !appearanceId || deletingVariantId) return
    if (!window.confirm(`确定删除「${active.name}」的变体「${variant.label}」吗？该变体的设定图也会一并移除。`)) return

    setDeletingVariantId(appearanceId)
    setError(null)
    setNotice(null)
    try {
      const search = new URLSearchParams({ characterId: active.id, appearanceId })
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/character/appearance?${search.toString()}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '删除角色变体失败'))
      setNotice(`已删除角色变体「${variant.label}」。`)
      data.refetch()
    } catch (deleteError) {
      logError('[FosAssetSetting] 删除角色变体失败', deleteError)
      setError(deleteError instanceof Error ? deleteError.message : '删除角色变体失败')
    } finally {
      setDeletingVariantId(null)
    }
  }

  const handleAssetCreated = (assetId: string | null) => {
    setNotice('资产已添加，可继续编辑提示词或生成设定图。')
    data.refetch()
    if (assetId) {
      const timer = window.setTimeout(() => setActiveId(assetId), 350)
      refreshTimers.current.push(timer)
    }
  }

  const handleVariantCreated = () => {
    setNotice(`已为「${active?.name || '角色'}」添加变体。`)
    data.refetch()
  }

  if (!active) {
    return (
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '240px 1fr' }}>
        <aside className="flex min-h-0 flex-col border-r border-[var(--fos-border-soft)]">
          <div className="flex-none p-3">
            <AssetTabs projectId={data.projectId} active={tab} />
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-bold text-white">{meta.listTitle}</h2>
              {canEdit ? <button className="text-[12px] font-bold text-[#4f85ff]" onClick={() => setShowAdd(true)}>+手动新增</button> : <span className="text-[11px] text-[var(--fos-text-4)]">只读</span>}
            </div>
          </div>
          <div className="px-4 py-6 text-[13px] leading-6 text-[var(--fos-text-3)]">尚未生成任何{meta.listTitle}。</div>
        </aside>
        <article className="flex min-h-0 items-center justify-center overflow-y-auto p-8">
          <div className="w-full max-w-[560px] rounded-2xl border border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] p-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--fos-primary-soft)] text-[#7ea4ff]"><AppIcon name="sparkles" className="h-7 w-7" /></span>
            <h2 className="mt-5 text-[20px] font-bold text-white">尚未解析项目资产</h2>
            <p className="mt-3 text-[13px] leading-6 text-[var(--fos-text-3)]">资产解析会读取全部分集剧本，生成角色、物品、环境及其标准生图提示词。不会在解析前展示示例资产。</p>
            {error ? <div className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">{error}</div> : null}
            {notice ? <div className="mt-4 rounded-lg border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-[13px] text-blue-200">{notice}</div> : null}
            <button type="button" className="fos-btn fos-btn-primary fos-btn-lg mt-6" disabled={!canEdit || !canExtract || extracting} onClick={() => void handleExtractAssets()}>
              <AppIcon name={extracting ? 'loader' : 'sparkles'} className={`h-4 w-4 ${extracting ? 'animate-spin' : ''}`} />
              {extracting
                ? `正在解析资产${extractionProgress !== null ? ` ${extractionProgress}%` : '…'}`
                : !canEdit ? '只读 · 资产师可操作' : canExtract ? '解析剧本资产' : '请先完成剧本解析'}
            </button>
          </div>
          {showAdd && canEdit ? <AddAssetDialog projectId={data.projectId} kind={tab} episodeNumbers={data.episodes.map((episode) => episode.episodeNumber)} onCreated={handleAssetCreated} onClose={() => setShowAdd(false)} /> : null}
        </article>
      </div>
    )
  }

  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '240px 1fr' }}>
      <aside className="flex min-h-0 flex-col border-r border-[var(--fos-border-soft)]">
        <div className="flex-none p-3">
          <AssetTabs projectId={data.projectId} active={tab} />
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-white">{meta.listTitle}</h2>
            <div className="flex items-center gap-2">
              {canEdit ? <button className="text-[12px] font-bold text-[#4f85ff]" onClick={() => setShowAdd(true)}>+新增</button> : <span className="text-[11px] text-[var(--fos-text-4)]">只读</span>}
              <span className="fos-pill" style={{ height: 22 }}>{count}/{count}</span>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-4">
          {list.map((a) => {
            const isActive = a.id === active?.id
            return (
              <div key={a.id}
                className="group flex w-full items-start gap-1.5 rounded-[10px]"
                style={{ border: isActive ? '1px solid var(--fos-primary)' : '1px solid transparent', background: isActive ? 'var(--fos-primary-soft)' : 'transparent' }}>
                <button
                  type="button"
                  onClick={() => setActiveId(a.id)}
                  className="min-w-0 flex-1 px-3 py-2.5 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[13px] font-bold text-white">{a.name}</span>
                    <AppIcon name="check" className="h-4 w-4 shrink-0 text-[#5bd08f]" />
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--fos-text-4)]">{a.type}</div>
                  {isActive && a.variants?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {a.variants.map((v) => (
                        <span key={v.label} className="rounded bg-[var(--fos-primary-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[#8fb0ff]">{v.label}</span>
                      ))}
                    </div>
                  ) : null}
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void handleDeleteAsset(a)}
                    disabled={Boolean(deletingId)}
                    className="mr-2 mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--fos-text-4)] opacity-70 transition hover:bg-[rgba(239,68,68,.14)] hover:text-[#ff7777] group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                    title={`删除${tab === 'characters' ? '角色' : tab === 'items' ? '物品' : '环境'} ${a.name}`}
                    aria-label={`删除${tab === 'characters' ? '角色' : tab === 'items' ? '物品' : '环境'} ${a.name}`}
                  >
                    <AppIcon name="trash" className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      </aside>

      <article className="min-h-0 overflow-y-auto p-6 pb-20">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[16px] font-bold text-white">
            {active?.name}
            <span className="rounded-md bg-[rgba(59,130,246,.18)] px-2.5 py-1 text-[12px] text-[#6ea0ff]">{active?.type}</span>
            {active?.episodes ? <span className="rounded-md bg-[var(--fos-fill-mid)] px-2.5 py-1 text-[12px] text-[var(--fos-text-3)]">{active.episodes}</span> : null}
          </h2>
          <div className="flex flex-wrap gap-2">
            <button className="fos-btn fos-btn-ghost fos-btn-sm" disabled={!canEdit || !canExtract || extracting} onClick={() => void handleExtractAssets()}>{!canEdit ? '只读模式' : extracting ? '解析中…' : '重新解析全部资产'}</button>
            <button
              className="fos-btn fos-btn-primary fos-btn-sm"
              disabled={!generationAllowed || !canEdit || !canGenerate || generatingAll || generatingKeys.size > 0}
              title={!generationAllowed ? '积分不足，无法生成' : undefined}
              onClick={() => void handleGenerateAll()}
            >
              {!canEdit
                ? '资产师可生成图片'
                : !generationAllowed
                ? '积分不足'
                : generatingAll
                ? `正在提交 ${allImageTargets.length} 张…`
                : tab === 'characters'
                  ? `一键生成全部主图和变体图（${allImageTargets.length}）`
                  : `一键生成全部${tab === 'items' ? '物品' : '环境'}（${allImageTargets.length}）`}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-[10px] border border-[rgba(239,68,68,.4)] bg-[rgba(239,68,68,.1)] px-3 py-2 text-[13px] font-semibold text-[#ff7777]">{error}</div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-[10px] border border-[rgba(59,130,246,.35)] bg-[rgba(59,130,246,.1)] px-3 py-2 text-[13px] font-semibold text-[#8fb0ff]">{notice}</div>
        ) : null}

        <div className="grid gap-6" style={{ gridTemplateColumns: '0.9fr 1.1fr' }}>
          <section className="space-y-4">
            <div>
              <h3 className="mb-2 text-[13px] font-bold text-[var(--fos-text-3)]">{meta.bgTitle}</h3>
              <p className="text-[13px] leading-7 text-[var(--fos-text-2)]">{active?.description ?? '暂无背景描述。'}</p>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-[var(--fos-text-3)]">{meta.promptTitle}</h3>
                {mainImageTarget ? (
                  <button className="fos-btn fos-btn-ghost fos-btn-sm" disabled={!canEdit || savingKeys.has(mainImageTarget.key)} onClick={() => void handleSavePrompt(mainImageTarget)}>
                    {savingKeys.has(mainImageTarget.key) ? '保存中…' : '保存描述'}
                  </button>
                ) : null}
              </div>
              <p className="mb-2 text-[12px] leading-5 text-[var(--fos-text-4)]">{meta.promptHint}</p>
              <textarea
                key={mainImageTarget?.key ?? active?.id ?? 'asset-prompt'}
                className="fos-textarea"
                style={{ minHeight: 260 }}
                readOnly={!canEdit}
                value={mainImageTarget ? (promptDrafts[mainImageTarget.key] ?? mainImageTarget.prompt) : ''}
                onChange={(event) => mainImageTarget && setPromptDrafts((current) => ({ ...current, [mainImageTarget.key]: event.target.value }))}
                placeholder="等待资产解析生成生图提示词"
              />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[14px] font-bold text-white">{meta.mediaTitle}</h3>
              <button className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => setShowHistory((v) => !v)}>
                <AppIcon name="clock" className="h-3.5 w-3.5" />生图历史
              </button>
            </div>
            <div className="relative overflow-hidden rounded-[10px] border border-[var(--fos-border-mid)]">
              <div className="aspect-[16/9]"><AssetPreview kind={tab} imageUrl={active?.imageUrl} alt={active?.name ?? meta.mediaTitle} /></div>
              {active?.imageUrl ? <button onClick={() => setZoom(true)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-white/80 hover:bg-black/70" title="放大查看"><AppIcon name="search" className="h-4 w-4" /></button> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {mainImageTarget ? (
                <button
                  className="fos-btn fos-btn-primary fos-btn-sm"
                  disabled={!generationAllowed || !canEdit || generatingAll || generatingKeys.has(mainImageTarget.key)}
                  title={!generationAllowed ? '积分不足，无法生成' : undefined}
                  onClick={() => void handleGenerateOne(mainImageTarget)}
                >
                  {!generationAllowed ? '积分不足' : generatingKeys.has(mainImageTarget.key) ? '提交中…' : mainImageTarget.imageUrl ? '重新生成主图' : '生成主图'}
                </button>
              ) : null}
              {mainImageTarget ? <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={!canEdit || !mainImageTarget.imageUrl || Boolean(modifyingKey)} title={mainImageTarget.imageUrl ? '以当前生成图为参考进行图生图修改' : '请先生成或导入一张图片'} onClick={() => setModifyTarget(mainImageTarget)}>AI 修改图片</button> : null}
              {mainImageTarget ? <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={!canEdit || Boolean(importingKey) || (tab === 'characters' && !mainImageTarget.appearanceId)} title="从素材库选择，选择器内也支持本地上传" onClick={() => setImportTarget(mainImageTarget)}>{importingKey === mainImageTarget.key ? '导入中…' : '导入素材'}</button> : null}
            </div>
            {showHistory ? <div className="mt-3"><HistoryPanel projectId={data.projectId} targets={activeImageTargets} refreshKey={historyRefreshKey} /></div> : null}
          </section>
        </div>

        {tab === 'characters' || active?.variants?.length ? (
          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><h3 className="text-[15px] font-bold text-white">{meta.variantTitle}</h3>{tab === 'characters' ? <p className="mt-1 text-[11px] text-[var(--fos-text-4)]">变体沿用主形象身份特征，并按对应分集映射到分镜。</p> : null}</div>
              {tab === 'characters' && canEdit ? <button type="button" className="fos-btn fos-btn-soft fos-btn-sm" onClick={() => setShowAddVariant(true)}><AppIcon name="plus" className="h-3.5 w-3.5" />添加角色变体</button> : null}
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              {(active?.variants || []).map((v, index) => {
                const target = variantImageTargets.find((item) => (
                  tab === 'characters'
                    ? item.appearanceId === v.appearanceId
                    : item.imageIndex === (v.imageIndex ?? index + 1)
                ))
                return (
                <div key={v.id || v.label} className="fos-card overflow-hidden p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[14px] font-bold text-white">{v.label}</span>
                    {v.episodes ? <span className="rounded-md bg-[var(--fos-fill-mid)] px-2 py-0.5 text-[11px] text-[var(--fos-text-3)]">{v.episodes}</span> : null}
                    {tab === 'characters' && canEdit && v.appearanceId ? <button type="button" className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-[#ff9292] hover:bg-red-500/10" disabled={Boolean(deletingVariantId)} title={`删除角色变体 ${v.label}`} onClick={() => void handleDeleteCharacterVariant(v)}><AppIcon name="trash" className="h-3.5 w-3.5" />{deletingVariantId === v.appearanceId ? '删除中…' : '删除变体'}</button> : null}
                  </div>
                  <div className="mb-3 rounded-[8px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h4 className="text-[12px] font-bold text-[var(--fos-text-3)]">{meta.variantPromptTitle}</h4>
                      {target ? <button type="button" className="text-[11px] font-bold text-[#8fa9ff]" disabled={!canEdit || savingKeys.has(target.key)} onClick={() => void handleSavePrompt(target)}>{savingKeys.has(target.key) ? '保存中…' : '保存提示词'}</button> : null}
                    </div>
                    {target ? (
                      <textarea
                        className="fos-textarea"
                        style={{ minHeight: 138 }}
                        readOnly={!canEdit}
                        value={promptDrafts[target.key] ?? target.prompt}
                        onChange={(event) => setPromptDrafts((current) => ({ ...current, [target.key]: event.target.value }))}
                      />
                    ) : <p className="whitespace-pre-wrap text-[12px] leading-6 text-[var(--fos-text-3)]">{getVariantDisplayText(v.description, v.changeText)}</p>}
                  </div>
                  <div className="overflow-hidden rounded-[8px] border border-[var(--fos-border-mid)]">
                    <div className="aspect-[16/9]"><AssetPreview kind={tab} imageUrl={v.imageUrl} alt={`${active?.name ?? ''} ${v.label}`} /></div>
                  </div>
                  {target ? <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" disabled={!generationAllowed || !canEdit || generatingAll || generatingKeys.has(target.key)} title={!generationAllowed ? '积分不足，无法生成' : undefined} onClick={() => void handleGenerateOne(target)}>{!generationAllowed ? '积分不足' : generatingKeys.has(target.key) ? '提交中…' : target.imageUrl ? '重新生成' : '生成图片'}</button>
                    <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={!canEdit || !target.imageUrl || Boolean(modifyingKey)} title={target.imageUrl ? '以当前图片为参考进行图生图修改' : '请先生成或导入一张图片'} onClick={() => setModifyTarget(target)}>AI 修改</button>
                    <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm" disabled={!canEdit || Boolean(importingKey) || (tab === 'characters' && !target.appearanceId)} title="从素材库选择或本地上传" onClick={() => setImportTarget(target)}>{importingKey === target.key ? '导入中…' : '导入素材'}</button>
                  </div> : null}
                </div>
                )
              })}
              {tab === 'characters' && !active?.variants?.length ? <div className="col-span-2 rounded-xl border border-dashed border-[var(--fos-border-mid)] bg-[var(--fos-bg-2)] px-5 py-8 text-center text-[12px] text-[var(--fos-text-4)]">当前只有主形象。需要服装、年龄、受伤或特殊状态时，可手动添加角色变体。</div> : null}
            </div>
          </section>
        ) : null}
      </article>

      {showAdd && canEdit ? <AddAssetDialog projectId={data.projectId} kind={tab} episodeNumbers={data.episodes.map((episode) => episode.episodeNumber)} onCreated={handleAssetCreated} onClose={() => setShowAdd(false)} /> : null}
      {showAddVariant && canEdit && tab === 'characters' && active ? <AddCharacterVariantDialog projectId={data.projectId} characterId={active.id} characterName={active.name} episodeNumbers={data.episodes.map((episode) => episode.episodeNumber)} onCreated={handleVariantCreated} onClose={() => setShowAddVariant(false)} /> : null}
      {zoom ? <ImageZoom onClose={() => setZoom(false)}><AssetPreview kind={tab} imageUrl={active?.imageUrl} alt={active?.name ?? meta.mediaTitle} /></ImageZoom> : null}
      {modifyTarget ? <AssetImageModifyDialog target={modifyTarget} submitting={modifyingKey === modifyTarget.key} onSubmit={(prompt) => void handleModifyImage(modifyTarget, prompt)} onClose={() => { if (!modifyingKey) setModifyTarget(null) }} /> : null}
      {importTarget ? <MaterialPickerDialog projectId={data.projectId} type="image" assetCategory={tab === 'characters' ? 'character' : tab === 'items' ? 'prop' : 'location'} title={`导入到 ${importTarget.label}`} confirmLabel="导入图片" onSelect={(material) => void handleImportMaterial(importTarget, material)} onClose={() => setImportTarget(null)} /> : null}
    </div>
  )
}
