'use client'

import { useMemo } from 'react'
import { CheckCircle2, Loader2, RefreshCw } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import { chapterHref } from '@/lib/interactive/routes'
import type { StoryIssue } from '@/lib/interactive/types'
import type { PreflightResult } from '@/lib/mp/release/preflight'

interface IssueGroup { key: string; title: string; issues: StoryIssue[] }

export function PreflightCard({ preflight, chapters, workId, rechecking, onRecheck }: {
  preflight: PreflightResult
  chapters: Array<{ projectId: string; title: string }>
  workId: string
  rechecking: boolean
  onRecheck: () => void
}) {
  const groups = useMemo(() => {
    const result: IssueGroup[] = []
    const global = preflight.issues.filter((issue) => !issue.projectId)
    if (global.length) result.push({ key: 'global', title: '全局', issues: global })
    for (const chapter of chapters) {
      const issues = preflight.issues.filter((issue) => issue.projectId === chapter.projectId)
      if (issues.length) result.push({ key: chapter.projectId, title: chapter.title, issues })
    }
    return result
  }, [preflight.issues, chapters])

  return (
    <section className="nori-mp-card">
      <div className="nori-mp-card-head">
        <h2>发布前检查</h2>
        <div className="nori-mp-card-head-side">
          <span className="nori-mp-check-count">{preflight.errors} 个错误 · {preflight.warnings} 个警告</span>
          <button type="button" className="fos-btn fos-btn-ghost" disabled={rechecking} onClick={onRecheck}>
            {rechecking ? <Loader2 className="nori-ix-spin" /> : <RefreshCw />}重新检查
          </button>
        </div>
      </div>
      {preflight.issues.length === 0 ? (
        <p className="nori-mp-ok"><CheckCircle2 />全部通过</p>
      ) : groups.map((group) => (
        <div key={group.key} className="nori-mp-issue-group">
          <h3>{group.title}</h3>
          <ul className="nori-mp-issues">
            {group.issues.map((issue, index) => (
              <li key={`${issue.code}:${issue.nodeId}:${index}`} className={`is-${issue.level}`}>
                <span>{issue.level === 'error' ? '问题' : '提醒'}</span>
                <p>{issue.message}</p>
                {issue.projectId ? <Link className="nori-mp-issue-link" href={chapterHref(workId, issue.projectId)}>去修改</Link> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
