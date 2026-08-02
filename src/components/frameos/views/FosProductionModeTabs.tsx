'use client'

import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'

export type FosProductionMode = 'generate' | 'edit'

export function FosProductionModeTabs({
  projectId,
  episodeId,
  active,
}: {
  projectId: string
  episodeId: string
  active: FosProductionMode
}) {
  const base = `/workflow/${projectId}/workbench-premium2/production`
  const items = [
    {
      key: 'generate' as const,
      label: '分镜生成',
      detail: '逐 Segment 生成视频',
      icon: 'film' as const,
      pathname: `${base}/shot`,
    },
    {
      key: 'edit' as const,
      label: '剪辑',
      detail: '整集预览与多轨粗剪',
      icon: 'edit' as const,
      pathname: `${base}/timeline`,
    },
  ]

  return (
    <nav className="flex items-end gap-2 border-b border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] px-4 pt-3" aria-label="制作剪辑工作模式">
      {items.map((item, index) => {
        const selected = active === item.key
        return (
          <Link
            key={item.key}
            href={{ pathname: item.pathname, query: { episode_id: episodeId } }}
            aria-current={selected ? 'page' : undefined}
            className={`group relative flex min-w-[190px] items-center gap-3 rounded-t-[10px] border border-b-0 px-4 py-2.5 transition ${selected ? 'border-[var(--fos-border-mid)] bg-[var(--fos-bg-1)] text-white' : 'border-transparent text-[var(--fos-text-3)] hover:bg-white/[.035] hover:text-white'}`}
          >
            <span className={`flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-black ${selected ? 'bg-[var(--fos-primary)] text-white' : 'bg-white/[.06] text-[var(--fos-text-3)]'}`}>{index + 1}</span>
            <AppIcon name={item.icon} className="h-4 w-4 text-[#8fa9ff]" />
            <span className="min-w-0"><strong className="block text-[13px]">{item.label}</strong><small className="block truncate text-[10px] font-medium text-[var(--fos-text-4)]">{item.detail}</small></span>
            {selected ? <i className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--fos-primary)]" /> : null}
          </Link>
        )
      })}
      <span className="ml-auto pb-3 text-[10px] font-semibold tracking-[.08em] text-[var(--fos-text-4)]">分镜生成 → 剪辑 → 提交评审</span>
    </nav>
  )
}
