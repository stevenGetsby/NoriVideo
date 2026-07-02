'use client'

import { AppIcon } from '@/components/ui/icons'
import { MappingPanel } from './MappingPanel'
import { NameIndexPanel } from './NameIndexPanel'
import { ReviewIssuePanel } from './ReviewIssuePanel'
import type { SettingsReviewView } from './types'

export function SettingsReviewPage({
  review,
  confirmLabel,
  regenerateLabel,
}: {
  review: SettingsReviewView
  confirmLabel: string
  regenerateLabel: string
}) {
  const isTarget = review.checkpoint === 'B'

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,740px)_380px]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)]">
          <div className="flex items-center gap-2 border-b border-[var(--fos-border-soft)] px-5 py-4 text-[15px] font-bold text-white">
            <AppIcon name={isTarget ? 'globe' : 'bookOpen'} className="h-4 w-4 text-[var(--fos-primary)]" />
            {review.outlineTitle}
          </div>
          <div className="max-h-[620px] overflow-y-auto px-5 py-5">
            <div className="space-y-6 text-[14px] leading-7 text-[var(--fos-text-2)]">
              {review.bodySections.map((section) => (
                <section key={section.heading}>
                  <h3 className="mb-2 text-[14px] font-bold text-white">{section.heading}</h3>
                  <p>{section.body}</p>
                </section>
              ))}
            </div>
          </div>
        </section>

        {isTarget ? (
          <MappingPanel title={review.collapsedPanelTitle} count={review.collapsedPanelCount} groups={review.nameIndexGroups} />
        ) : (
          <NameIndexPanel title={review.collapsedPanelTitle} count={review.collapsedPanelCount} groups={review.nameIndexGroups} />
        )}
      </div>

      <aside className="space-y-5">
        <ReviewIssuePanel title={review.issuePanelTitle} count={review.issueCount} issues={review.issues} />
        <section className="rounded-[12px] border border-[var(--fos-border-soft)] bg-[var(--fos-bg-2)] p-5">
          <h3 className="text-[15px] font-bold text-white">修改反馈</h3>
          <textarea
            className="fos-textarea mt-4"
            style={{ minHeight: 92 }}
            placeholder={review.feedbackPlaceholder}
          />
          <button type="button" className="fos-btn mt-3 w-full opacity-70">
            <AppIcon name="refresh" className="h-4 w-4" />
            {regenerateLabel}
          </button>
          <button type="button" className="fos-btn fos-btn-primary mt-3 w-full">
            {confirmLabel}
          </button>
        </section>
      </aside>
    </div>
  )
}
