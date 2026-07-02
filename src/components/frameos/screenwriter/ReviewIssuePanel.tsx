import { AppIcon } from '@/components/ui/icons'
import type { ReviewIssue } from './types'

export function ReviewIssuePanel({
  title,
  count,
  issues,
}: {
  title: string
  count: number
  issues: ReviewIssue[]
}) {
  return (
    <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)]">
      <div className="flex items-center justify-between border-b border-[var(--fos-border-soft)] px-5 py-4">
        <div className="flex items-center gap-2 text-[14px] font-bold text-white">
          <AppIcon name="infoCircle" className="h-4 w-4 text-[var(--fos-primary)]" />
          {title}
        </div>
        <span className="rounded-full bg-[rgba(245,158,11,.2)] px-2 py-1 text-[12px] font-bold text-[#fbbf24]">{count} 项</span>
      </div>
      <div className="max-h-[540px] space-y-3 overflow-y-auto p-4">
        {issues.map((issue) => (
          <article key={issue.id} className="rounded-[10px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-3)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[13px] font-bold text-[#fde047]">{issue.label}</div>
              <div className="text-[12px] font-bold text-[var(--fos-text-3)]">{issue.category}</div>
            </div>
            <div className="mt-4 space-y-3 text-[13px] leading-6 text-[var(--fos-text-2)]">
              <div>
                <div className="mb-1 text-[12px] text-[var(--fos-text-4)]">当前处理</div>
                {issue.currentHandling}
              </div>
              <div>
                <div className="mb-1 text-[12px] text-[var(--fos-text-4)]">判断依据</div>
                {issue.evidence}
              </div>
              <div>
                <div className="mb-1 text-[12px] text-[var(--fos-text-4)]">存在风险</div>
                {issue.risk}
              </div>
              <div>
                <div className="mb-1 text-[12px] text-[var(--fos-text-4)]">请重点确认</div>
                {issue.confirmationPrompt}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
