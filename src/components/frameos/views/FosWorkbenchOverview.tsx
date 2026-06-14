'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import { ExportDeliveryDialog } from '../ExportDeliveryDialog'
import type { FosProjectData } from '../useFosProject'

type Tone = 'done' | 'failed' | 'pending' | 'idle'

function StageCard({
  step, title, status, tone, emphasized, children, footer,
}: {
  step: string; title: string; status: string; tone: Tone
  emphasized?: boolean; children: ReactNode; footer: ReactNode
}) {
  return (
    <article className="flex flex-col rounded-[10px] border p-5"
      style={{
        background: 'var(--fos-bg-2)',
        borderColor: emphasized ? 'var(--fos-primary)' : 'var(--fos-border-mid)',
        boxShadow: emphasized ? '0 0 0 1px var(--fos-primary-border)' : 'none',
        minHeight: 560,
      }}>
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="fos-pill" style={{ height: 22 }}>{step}</span>
          <h2 className="text-[15px] font-bold text-white">{title}</h2>
        </div>
        <span className={`fos-status ${tone}`}>{status}</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      <div className="mt-5">{footer}</div>
    </article>
  )
}

export function FosWorkbenchOverview({ data }: { data: FosProjectData }) {
  const [showExport, setShowExport] = useState(false)
  const { projectId } = data
  const base = `/workflow/${projectId}/workbench-premium2`
  const episodeCount = data.usingDemo ? 30 : data.episodes.length
  const charCount = data.usingDemo ? 22 : data.characters.length
  const itemCount = data.usingDemo ? 15 : data.items.length
  const envCount = data.usingDemo ? 30 : data.environments.length

  const assetRows: Array<[string, string, string, string]> = [
    ['角色', `已确认 ${charCount}/${charCount}`, `主图 ${charCount}/${charCount} · 变体图 7/7`, 'characters'],
    ['物品', `已确认 ${itemCount}/${itemCount}`, `主图 ${itemCount}/${itemCount} · 变体图 1/1`, 'items'],
    ['环境', `已确认 ${envCount}/${envCount}`, `主图 ${envCount}/${envCount}`, 'environments'],
    ['音色', '待匹配', `角色音色 0/${charCount}`, 'timbre'],
  ]

  return (
    <div className="fos-scroll">
      <section className="px-6 py-7">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-[18px] font-bold text-white">项目工作台</h2>
          <p className="hidden text-[13px] text-[var(--fos-text-3)] lg:block">按主流程从左到右推进；每个阶段卡片同时提供状态、摘要和主要操作入口。</p>
        </div>
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <StageCard step="Step 1" title="剧本解析" status="已完成" tone="done"
            footer={<Link href={{ pathname: `${base}/script-review` }} className="fos-btn fos-btn-ghost w-full">查看解析详情</Link>}>
            <div className="space-y-4 text-[13px] text-white">
              <p className="font-bold">核心产出：{episodeCount} 集</p>
              <p className="text-[var(--fos-text-3)]">剧本：约 19700 字</p>
              <p className="leading-7 text-[var(--fos-text-3)]">将原始素材整理为结构化的分集分场剧本，作为后续设定与制作的统一基础。</p>
            </div>
          </StageCard>

          <StageCard step="Step 2" title="资产设定" status="已完成" tone="done"
            footer={<Link href={{ pathname: `${base}/assets/characters` }} className="fos-btn fos-btn-soft w-full">设定</Link>}>
            <p className="mb-4 text-[13px] leading-7 text-[var(--fos-text-2)]">确认角色、物品、环境、音色四类核心资产，建立后续可复用的一致性设定。</p>
            <div className="space-y-2.5">
              {assetRows.map(([label, statusText, detail, href]) => (
                <div key={label} className="grid items-center gap-2 rounded-[10px] border border-[var(--fos-border-mid)] bg-[var(--fos-bg-3)] px-3 py-2.5"
                  style={{ gridTemplateColumns: '40px 1fr 56px' }}>
                  <div className="text-[13px] font-bold text-white">{label}</div>
                  <div className="min-w-0">
                    <div className={label === '音色' ? 'text-[12px] font-bold text-[var(--fos-text-3)]' : 'text-[12px] font-bold text-[#59c98d]'}>{statusText}</div>
                    <div className="mt-0.5 truncate text-[11px] text-[var(--fos-text-4)]">{detail}</div>
                  </div>
                  <Link href={{ pathname: `${base}/assets/${href}` }} className="fos-btn fos-btn-soft fos-btn-sm">{label === '音色' ? '设置' : '设定'}</Link>
                </div>
              ))}
            </div>
          </StageCard>

          <StageCard step="Step 3" title="分镜设计" status="失败" tone="failed" emphasized
            footer={<Link href={{ pathname: `${base}/storyboard` }} className="fos-btn fos-btn-primary w-full">进入分镜设计</Link>}>
            <div className="space-y-4">
              <p className="text-[13px] font-bold text-white">{episodeCount} 集 · {episodeCount} 镜 · 总长约 6 分钟 · 已确认 0/{episodeCount} 集</p>
              <p className="text-[13px] leading-7 text-[var(--fos-text-2)]">把剧本进一步拆解为可直接制作的分镜，明确画面推进、对白与节奏。</p>
              <p className="text-[12px] text-[var(--fos-text-3)]">前置：资产设定审阅通过后，可提取分镜。</p>
              <div className="rounded-[10px] border border-[rgba(239,68,68,.35)] bg-[rgba(239,68,68,.08)] px-3 py-2.5 text-[12px] font-bold text-[#ff7777]">
                第 1 集镜头编排失败，可进入分镜设计按场景重试。
              </div>
            </div>
          </StageCard>

          <StageCard step="Step 4" title="制作剪辑" status="未开始" tone="idle"
            footer={
              <div className="space-y-3">
                <Link href={{ pathname: `${base}/production/timeline` }} className="fos-btn w-full" style={{ background: 'var(--fos-bg-4)', color: 'var(--fos-text-3)' }}>时间线 · 组装预览</Link>
                <button type="button" className="fos-btn fos-btn-ghost w-full" onClick={() => setShowExport(true)}>导出交付</button>
              </div>
            }>
            <p className="text-[13px] leading-7 text-[var(--fos-text-2)]">使用最前沿的 Seedance 2.0 模型，生成各分镜的视频，并完成配乐与组装。</p>
            <p className="mt-4 text-[12px] text-[var(--fos-text-3)]">前置：分镜设计审阅通过后，可进行制作。</p>
          </StageCard>
        </div>
      </section>
      {showExport ? <ExportDeliveryDialog episodeCount={episodeCount} onClose={() => setShowExport(false)} /> : null}
    </div>
  )
}
