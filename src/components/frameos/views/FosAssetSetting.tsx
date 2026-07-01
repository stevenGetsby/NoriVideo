'use client'

import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { logError } from '@/lib/logging/core'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { MediaImage } from '@/components/media/MediaImage'
import { demoCharacters, demoItems, demoEnvironments } from '../fosDemoData'
import type { FosProjectData, FosAsset } from '../useFosProject'
import { AssetTabs, AssetPlaceholder, AddAssetDialog, ImageZoom, type AssetTab } from './FosAssetShared'

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
  if (data.usingDemo) return tab === 'characters' ? demoCharacters : tab === 'items' ? demoItems : demoEnvironments
  return tab === 'characters' ? data.characters : tab === 'items' ? data.items : data.environments
}

function HistoryPanel() {
  const rows: Array<[string, string, string, string]> = [
    ['16:21', 'character_image', '已完成', '主图 · 16:9 · 480p'],
    ['16:18', 'character_image', '生成失败', '余额不足，未扣费'],
    ['16:06', '导入素材', '已完成', '来自素材库 · 已选用'],
  ]
  return (
    <div className="fos-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--fos-border-soft)] px-4 py-2.5">
        <h4 className="text-[13px] font-bold text-white">生图历史</h4>
        <button className="text-[12px] font-bold text-[#8fa9ff]">展示失败记录</button>
      </div>
      <div className="divide-y divide-[var(--fos-border-soft)]">
        {rows.map(([time, model, status, note]) => (
          <div key={`${time}-${status}`} className="grid items-center gap-3 px-4 py-2.5 text-[12px]" style={{ gridTemplateColumns: '48px 1fr 64px' }}>
            <div className="text-[var(--fos-text-4)]">{time}</div>
            <div className="min-w-0"><div className="truncate font-bold text-[var(--fos-text-2)]">{model}</div><div className="truncate text-[var(--fos-text-4)]">{note}</div></div>
            <div className={status === '生成失败' ? 'text-right font-bold text-[#ff7777]' : 'text-right font-bold text-[#5bd08f]'}>{status}</div>
          </div>
        ))}
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
  if (!src) return <AssetPlaceholder kind={kind} />
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

export function FosAssetSetting({ data, tab }: { data: FosProjectData; tab: Exclude<AssetTab, 'timbre'> }) {
  const meta = PAGE_META[tab]
  const list = useAssetList(data, tab)
  const [activeId, setActiveId] = useState(list[0]?.id ?? '')
  const [showAdd, setShowAdd] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refreshTimers = useRef<number[]>([])
  const active = list.find((a) => a.id === activeId) ?? list[0]
  const count = list.length
  const canGenerate = !data.usingDemo && list.length > 0

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

  const submitSingleImageTask = async (asset: FosAsset, appearanceId?: string | null) => {
    const isCharacter = tab === 'characters'
    const res = await apiFetch(`/api/novel-promotion/${data.projectId}/regenerate-single-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locale: 'zh',
        type: isCharacter ? 'character' : 'location',
        id: asset.id,
        ...(isCharacter && appearanceId ? { appearanceId } : {}),
        imageIndex: 0,
      }),
    })
    if (!res.ok) throw new Error(await readApiErrorMessage(res, '提交生图任务失败'))
    return 1
  }

  const generateAssetImages = async (asset: FosAsset) => {
    if (tab === 'characters') {
      let submitted = await submitSingleImageTask(asset, asset.mainAppearanceId)
      for (const variant of asset.variants ?? []) {
        if (variant.appearanceId) submitted += await submitSingleImageTask(asset, variant.appearanceId)
      }
      return submitted
    }
    return await submitSingleImageTask(asset)
  }

  const handleGenerateActive = async () => {
    if (!active || !canGenerate) return
    setGenerating(true)
    setError(null)
    setNotice(null)
    try {
      const submitted = await generateAssetImages(active)
      setNotice(`已提交 ${submitted} 个生图任务，可在任务状态中查看进度。`)
      scheduleImageRefreshes()
    } catch (err) {
      logError('[FosAssetSetting] 一键生成当前资产失败', err)
      setError(err instanceof Error ? err.message : '提交生图任务失败')
    } finally {
      setGenerating(false)
    }
  }

  const handleDeleteCharacter = async (asset: FosAsset) => {
    if (tab !== 'characters' || data.usingDemo || deletingId) return
    const confirmed = window.confirm(`确定删除角色「${asset.name}」吗？该角色的形象记录也会一并删除。`)
    if (!confirmed) return

    setDeletingId(asset.id)
    setError(null)
    setNotice(null)
    try {
      const res = await apiFetch(`/api/novel-promotion/${data.projectId}/character?id=${encodeURIComponent(asset.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await readApiErrorMessage(res, '删除角色失败'))
      if (asset.id === activeId) {
        const next = list.find((item) => item.id !== asset.id)
        setActiveId(next?.id ?? '')
      }
      setNotice(`已删除角色「${asset.name}」。`)
      data.refetch()
    } catch (err) {
      logError('[FosAssetSetting] 删除角色失败', err)
      setError(err instanceof Error ? err.message : '删除角色失败')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '240px 1fr' }}>
      <aside className="flex min-h-0 flex-col border-r border-[var(--fos-border-soft)]">
        <div className="flex-none p-3">
          <AssetTabs projectId={data.projectId} active={tab} />
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-white">{meta.listTitle}</h2>
            <div className="flex items-center gap-2">
              <button className="text-[12px] font-bold text-[#4f85ff]" onClick={() => setShowAdd(true)}>+新增</button>
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
                {tab === 'characters' && !data.usingDemo ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteCharacter(a)}
                    disabled={Boolean(deletingId)}
                    className="mr-2 mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--fos-text-4)] opacity-70 transition hover:bg-[rgba(239,68,68,.14)] hover:text-[#ff7777] group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                    title={`删除角色 ${a.name}`}
                    aria-label={`删除角色 ${a.name}`}
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
            <button className="fos-btn fos-btn-ghost fos-btn-sm">补充提取</button>
            <button className="fos-btn fos-btn-ghost fos-btn-sm">重新提取</button>
            <button
              className="fos-btn fos-btn-primary fos-btn-sm"
              disabled={!canGenerate || generating}
              onClick={handleGenerateActive}
            >
              {generating ? '提交中…' : tab === 'characters' ? '一键生成主图和变体图' : '一键生成'}
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
                <button className="fos-btn fos-btn-ghost fos-btn-sm">保存描述</button>
              </div>
              <p className="mb-2 text-[12px] leading-5 text-[var(--fos-text-4)]">{meta.promptHint}</p>
              <textarea
                key={active?.id ?? 'asset-prompt'}
                className="fos-textarea"
                style={{ minHeight: 260 }}
                defaultValue={active?.prompt ?? ''}
                placeholder="等待资产解析生成生图提示词"
              />
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <button className="fos-btn fos-btn-soft fos-btn-sm">出场集</button>
              <button className="fos-btn fos-btn-ghost fos-btn-sm">全部选中</button>
              <button className="fos-btn fos-btn-ghost fos-btn-sm">全部清除</button>
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
              <button onClick={() => setZoom(true)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-white/80 hover:bg-black/70" title="放大查看">
                <AppIcon name="search" className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="fos-btn fos-btn-primary fos-btn-sm" disabled={!active || !canGenerate || generating} onClick={handleGenerateActive}>{generating ? '提交中…' : '生成'}</button>
              {['重新生成', 'AI 修改图片', '导入素材'].map((t) => <button key={t} className="fos-btn fos-btn-ghost fos-btn-sm">{t}</button>)}
            </div>
            {showHistory ? <div className="mt-3"><HistoryPanel /></div> : null}
          </section>
        </div>

        {active?.variants?.length ? (
          <section className="mt-8">
            <h3 className="mb-3 text-[15px] font-bold text-white">{meta.variantTitle}</h3>
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              {active.variants.map((v) => (
                <div key={v.label} className="fos-card overflow-hidden p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[14px] font-bold text-white">{v.label}</span>
                    {v.episodes ? <span className="rounded-md bg-[var(--fos-fill-mid)] px-2 py-0.5 text-[11px] text-[var(--fos-text-3)]">{v.episodes}</span> : null}
                  </div>
                  <div className="mb-3 rounded-[8px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] p-3">
                    <h4 className="mb-2 text-[12px] font-bold text-[var(--fos-text-3)]">{meta.variantPromptTitle}</h4>
                    <p className="whitespace-pre-wrap text-[12px] leading-6 text-[var(--fos-text-3)]">{getVariantDisplayText(v.description, v.changeText)}</p>
                  </div>
                  <div className="overflow-hidden rounded-[8px] border border-[var(--fos-border-mid)]">
                    <div className="aspect-[16/9]"><AssetPreview kind={tab} imageUrl={v.imageUrl} alt={`${active?.name ?? ''} ${v.label}`} /></div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </article>

      <div className="fos-bottom-bar" style={{ gridColumn: '1 / -1' }}>
        <button className="fos-btn fos-btn-ghost">取消</button>
        <button className="fos-btn fos-btn-soft">取消确认</button>
      </div>

      {showAdd ? <AddAssetDialog kind={tab} onClose={() => setShowAdd(false)} /> : null}
      {zoom ? <ImageZoom onClose={() => setZoom(false)}><AssetPreview kind={tab} imageUrl={active?.imageUrl} alt={active?.name ?? meta.mediaTitle} /></ImageZoom> : null}
    </div>
  )
}
