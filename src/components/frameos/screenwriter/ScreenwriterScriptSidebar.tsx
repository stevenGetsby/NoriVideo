'use client'

import { AppIcon } from '@/components/ui/icons'
import type { ScreenwriterScriptStatus, ScreenwriterScriptSummary } from './types'

const STATUS_TABS: Array<{ key: ScreenwriterScriptStatus; label: string }> = [
  { key: 'draft', label: '草稿' },
  { key: 'available', label: '可用' },
  { key: 'archived', label: '已归档' },
]

export function ScreenwriterScriptSidebar({
  scripts,
  selectedScriptId,
  onSelectScript,
}: {
  scripts: ScreenwriterScriptSummary[]
  selectedScriptId?: string | null
  onSelectScript: (scriptId: string) => void
}) {
  const counts = STATUS_TABS.reduce<Record<ScreenwriterScriptStatus, number>>((acc, tab) => {
    acc[tab.key] = scripts.filter((script) => script.status === tab.key).length
    return acc
  }, { draft: 0, available: 0, archived: 0 })

  const visibleScripts = scripts.filter((script) => script.status === 'draft')

  return (
    <aside className="flex w-[250px] flex-none flex-col border-r border-[var(--fos-border-soft)] bg-[rgba(255,255,255,.02)]">
      <div className="flex items-center justify-between px-4 py-4">
        <h2 className="text-[18px] font-bold text-white">我的剧本</h2>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] text-[var(--fos-text-4)]"
          title="收起剧本列表"
        >
          <AppIcon name="chevronLeft" className="h-4 w-4" />
        </button>
      </div>
      <div className="mx-4 flex items-center gap-1 rounded-[8px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-1)] p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="flex h-7 flex-1 items-center justify-center gap-1 rounded-[6px] text-[12px] font-bold text-[var(--fos-text-3)] first:bg-[var(--fos-bg-3)] first:text-white"
          >
            {tab.label}
            <span className="rounded-full bg-[var(--fos-fill-mid)] px-1.5 py-0.5 text-[10px] text-[var(--fos-text-2)]">{counts[tab.key]}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-5">
        {visibleScripts.map((script) => {
          const active = script.id === selectedScriptId
          return (
            <button
              key={script.id}
              type="button"
              onClick={() => onSelectScript(script.id)}
              className="w-full rounded-[10px] border border-transparent px-2 py-3 text-left transition-colors hover:border-[var(--fos-border-soft)] hover:bg-[var(--fos-bg-2)]"
              style={{ background: active ? 'var(--fos-bg-2)' : 'transparent' }}
            >
              <span className="block text-[13px] font-bold text-white">
                {script.title}
                <span className="ml-1 text-[12px] text-[var(--fos-text-4)]">· {script.episodeCount} 集</span>
              </span>
              <span className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-bold text-[#7da2ff]">{script.taskLabel}</span>
                {script.activeTaskLabel ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(59,110,242,.12)] px-2 py-1 text-[12px] font-bold text-[#7da2ff]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#7da2ff]" />
                    {script.activeTaskLabel}
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
        <div className="mt-5 flex items-center gap-2 text-[12px] text-[var(--fos-text-4)]">
          <span className="h-px flex-1 bg-[var(--fos-border-soft)]" />
          已显示全部
          <span className="h-px flex-1 bg-[var(--fos-border-soft)]" />
        </div>
      </div>
    </aside>
  )
}
