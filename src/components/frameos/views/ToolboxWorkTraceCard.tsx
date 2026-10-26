import { Fragment } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { ToolboxWorkTrace } from './toolbox-work-trace'

function traceStatusToneClass(tone: ToolboxWorkTrace['statusTone']) {
  if (tone === 'success') return 'border-emerald-300/35 bg-emerald-500/10 text-emerald-200'
  if (tone === 'failure') return 'border-red-400/30 bg-red-500/10 text-red-200'
  if (tone === 'active') return 'border-white/25 bg-white/8 text-neutral-200'
  return 'border-[var(--fos-border-soft)] bg-[var(--fos-bg-3)] text-[var(--fos-text-3)]'
}

function traceReferenceToneClass(type: string) {
  if (type === 'image') return 'border-emerald-300/25 bg-emerald-500/10 text-emerald-200'
  if (type === 'video') return 'border-white/15 bg-white/8 text-neutral-200'
  if (type === 'audio') return 'border-violet-300/25 bg-violet-500/10 text-violet-200'
  return 'border-[var(--fos-border-soft)] bg-[var(--fos-bg-3)] text-[var(--fos-text-3)]'
}

export function WorkTraceCard({ trace, copyState, onCopy }: { trace: ToolboxWorkTrace; copyState: 'idle' | 'copied' | 'failed'; onCopy: () => void }) {
  const copyLabel = copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制留痕'
  return (
    <section className="mt-4 overflow-hidden rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)]" aria-label="工作留痕">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--fos-border-soft)] px-4 py-3">
        <span className="text-[13px] font-bold text-white">工作留痕</span>
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${traceStatusToneClass(trace.statusTone)}`}>{trace.statusLabel}</span>
        <span className="rounded-full border border-[var(--fos-border-soft)] bg-[var(--fos-bg-3)] px-2 py-0.5 text-[10px] text-[var(--fos-text-3)]">{trace.costLabel}</span>
        <button type="button" className="fos-btn fos-btn-ghost fos-btn-sm ml-auto" title="复制提示词、参数、参考素材与任务信息" onClick={onCopy}>
          <AppIcon name={copyState === 'copied' ? 'check' : 'copy'} className="h-3.5 w-3.5" />
          {copyLabel}
        </button>
      </header>
      <div className="grid gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[.08em] text-[var(--fos-text-4)]">提示词</div>
          <p className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--fos-border-soft)] bg-black/20 px-3 py-2.5 text-[12px] leading-5 text-[var(--fos-text-2)]">{trace.prompt || '未记录提示词'}</p>
          {trace.errorMessage || trace.errorCode ? (
            <div className="mt-3 rounded-lg border border-red-400/20 bg-red-500/[.08] px-3 py-2 text-[11px] leading-5 text-red-100">
              <div className="mb-0.5 font-bold text-red-200">失败原因{trace.errorCode ? ` · ${trace.errorCode}` : ''}</div>
              <p className="break-words">{trace.errorMessage || '生成服务未返回错误详情。'}</p>
            </div>
          ) : null}
        </div>
        <dl className="grid min-w-0 grid-cols-[76px_minmax(0,1fr)] content-start gap-x-3 gap-y-2 text-[11px]">
          <dt className="text-[var(--fos-text-4)]">模型</dt><dd className="min-w-0 break-words font-semibold text-[var(--fos-text-2)]">{trace.model}</dd>
          <dt className="text-[var(--fos-text-4)]">模式</dt><dd className="min-w-0 break-words font-semibold text-[var(--fos-text-2)]">{trace.mode}</dd>
          {trace.options.map((option) => (
            <Fragment key={option.label}>
              <dt className="text-[var(--fos-text-4)]">{option.label}</dt>
              <dd className="min-w-0 break-words font-semibold text-[var(--fos-text-2)]">{option.value}</dd>
            </Fragment>
          ))}
          {trace.assetCategoryLabel ? <><dt className="text-[var(--fos-text-4)]">资产归类</dt><dd className="font-semibold text-[var(--fos-text-2)]">{trace.assetCategoryLabel}</dd></> : null}
          <dt className="text-[var(--fos-text-4)]">提交时间</dt><dd className="min-w-0 break-words font-semibold text-[var(--fos-text-2)]">{trace.createdAtLabel}</dd>
          {trace.taskId ? <><dt className="text-[var(--fos-text-4)]">任务 ID</dt><dd className="min-w-0 break-all font-mono text-[10px] leading-5 text-[var(--fos-text-3)]">{trace.taskId}</dd></> : null}
        </dl>
      </div>
      <div className="border-t border-[var(--fos-border-soft)] px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[.08em] text-[var(--fos-text-4)]">参考素材</span>
          <span className="text-[10px] text-[var(--fos-text-4)]">{trace.references.length} 个</span>
        </div>
        {trace.references.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {trace.references.map((reference, index) => (
              <span key={`${reference.title}:${index}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--fos-border-soft)] bg-[var(--fos-bg-3)] px-2 py-1 text-[10px] text-[var(--fos-text-3)]">
                <span className={`inline-flex shrink-0 items-center rounded border px-1 py-0.5 text-[9px] font-bold ${traceReferenceToneClass(reference.type)}`}>{reference.typeLabel}</span>
                <span className="min-w-0 max-w-[220px] truncate font-semibold text-[var(--fos-text-2)]" title={reference.title}>{reference.title}</span>
                <span className="shrink-0 text-[var(--fos-text-4)]">{reference.roleLabel}{reference.durationLabel ? ` · ${reference.durationLabel}` : ''}</span>
              </span>
            ))}
          </div>
        ) : <p className="text-[11px] leading-5 text-[var(--fos-text-4)]">未使用参考素材。</p>}
      </div>
    </section>
  )
}
