'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

type Tab = 'assets' | 'jianying' | 'finished'

const ASSET_TYPES = ['角色图片', '物品图片', '环境图片', '分镜视频', 'BGM']

export function ExportDeliveryDialog({
  episodeCount = 30,
  onClose,
}: {
  episodeCount?: number
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('assets')
  const allEpisodes = Array.from({ length: episodeCount }, (_, i) => i + 1)
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<number>>(new Set(allEpisodes))
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(ASSET_TYPES))
  const [folderName, setFolderName] = useState('TEST_成片导出')
  const [bgmMix, setBgmMix] = useState(40)

  const toggleEpisode = (n: number) => setSelectedEpisodes((prev) => {
    const next = new Set(prev)
    if (next.has(n)) next.delete(n); else next.add(n)
    return next
  })
  const toggleType = (t: string) => setSelectedTypes((prev) => {
    const next = new Set(prev)
    if (next.has(t)) next.delete(t); else next.add(t)
    return next
  })

  const exportDisabled = selectedEpisodes.size === 0

  return (
    <div className="fos-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="fos-dialog" style={{ maxWidth: 760 }}>
        <div className="fos-dialog-head">
          <div className="fos-dialog-title">导出交付</div>
          <button type="button" className="fos-dialog-x" onClick={onClose}><AppIcon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="px-5 pt-4">
          <div className="flex gap-6 border-b border-[var(--fos-border-soft)]">
            {([['assets', '资产包'], ['jianying', '剪映草稿'], ['finished', '成片']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)}
                className="relative h-9 text-[13px] font-bold"
                style={{ color: tab === key ? 'var(--fos-primary)' : 'var(--fos-text-2)' }}>
                {label}
                {tab === key ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--fos-primary)]" /> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="fos-dialog-body" style={{ display: 'grid', gap: 16 }}>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-white">选择剧集</span>
              <div className="flex gap-2">
                <button className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => setSelectedEpisodes(new Set(allEpisodes))}>全选</button>
                <button className="fos-btn fos-btn-ghost fos-btn-sm" onClick={() => setSelectedEpisodes(new Set())}>清空</button>
              </div>
            </div>
            <div className="flex max-h-[140px] flex-wrap gap-2 overflow-y-auto rounded-[10px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-1)] p-3">
              {allEpisodes.map((n) => {
                const active = selectedEpisodes.has(n)
                return (
                  <button key={n} type="button" onClick={() => toggleEpisode(n)}
                    className="h-7 rounded-full px-3 text-[12px] font-bold"
                    style={{
                      background: active ? 'var(--fos-primary)' : 'var(--fos-bg-3)',
                      color: active ? '#fff' : 'var(--fos-text-3)',
                    }}>
                    E{n}
                  </button>
                )
              })}
            </div>
          </div>

          {tab === 'assets' ? (
            <div>
              <div className="mb-2 text-[13px] font-semibold text-white">资产类型</div>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {ASSET_TYPES.map((t) => {
                  const active = selectedTypes.has(t)
                  return (
                    <button key={t} type="button" onClick={() => toggleType(t)}
                      className="flex items-center justify-between rounded-[10px] border px-3 py-2.5 text-[13px] font-semibold"
                      style={{
                        borderColor: active ? 'var(--fos-primary)' : 'var(--fos-border-mid)',
                        background: active ? 'var(--fos-primary-soft)' : 'var(--fos-bg-2)',
                        color: active ? '#fff' : 'var(--fos-text-2)',
                      }}>
                      {t}
                      {active ? <AppIcon name="check" className="h-4 w-4 text-[var(--fos-primary)]" /> : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {tab === 'jianying' ? (
            <div className="fos-card p-4 text-[13px] leading-7 text-[var(--fos-text-2)]">
              <div className="mb-2 font-bold text-white">剪映草稿导出</div>
              下载素材 → 探测元数据 → 写入草稿结构 → 打包 zip。导出后可在剪映打开继续精修。
              <div className="mt-3 text-[12px] text-[var(--fos-text-4)]">桌面端可直接写入剪映草稿目录；Web 端导出 zip。</div>
            </div>
          ) : null}

          {tab === 'finished' ? (
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <div className="mb-2 text-[13px] font-semibold text-white">导出文件夹名称</div>
                <input className="fos-input" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-[13px] font-semibold text-white">
                  <span>BGM 混音强度</span><span className="text-[var(--fos-text-3)]">{bgmMix}%</span>
                </div>
                <input type="range" min={0} max={100} value={bgmMix} onChange={(e) => setBgmMix(Number(e.target.value))} className="w-full accent-[var(--fos-primary)]" />
              </div>
            </div>
          ) : null}
        </div>
        <div className="fos-dialog-foot">
          <button type="button" className="fos-btn fos-btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="fos-btn fos-btn-primary fos-btn-lg" disabled={exportDisabled}
            title="导出为后端/文件副作用操作，演示中已禁用">
            {tab === 'assets' ? '导出资产包' : tab === 'jianying' ? '导出剪映草稿' : '导出成片'}
          </button>
        </div>
      </div>
    </div>
  )
}
