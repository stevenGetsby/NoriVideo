import { AppIcon } from '@/components/ui/icons'
import type { NameIndexGroup } from './types'

export function NameIndexPanel({
  title,
  count,
  groups,
}: {
  title: string
  count: number
  groups: NameIndexGroup[]
}) {
  return (
    <section className="rounded-[10px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)]">
      <div className="flex items-center justify-between border-b border-[var(--fos-border-soft)] px-5 py-3">
        <div className="flex items-center gap-2 text-[14px] font-bold text-white">
          <AppIcon name="link" className="h-4 w-4 text-[var(--fos-primary)]" />
          {title}
          <span className="rounded-full bg-[var(--fos-fill-mid)] px-2 py-0.5 text-[12px] text-[var(--fos-text-3)]">{count} 项</span>
        </div>
        <span className="text-[12px] text-[var(--fos-text-3)]">点击展开</span>
      </div>
      <div className="space-y-5 p-5">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="mb-2 text-[13px] font-bold text-[var(--fos-text-3)]">{group.title}</div>
            <div className="space-y-2">
              {group.rows.map((row) => (
                <div key={`${group.title}-${row.sourceName}`} className="grid gap-3 text-[13px] leading-6 text-[var(--fos-text-2)] md:grid-cols-[140px_1fr]">
                  <span className="font-bold text-white">{row.sourceName}</span>
                  <span>
                    <span className="text-[var(--fos-text-4)]">→ </span>
                    {row.targetName}
                    {row.description ? <span className="text-[var(--fos-text-3)]">（{row.description}）</span> : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
