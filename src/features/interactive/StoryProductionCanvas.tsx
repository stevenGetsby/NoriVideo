'use client'

import { useMemo, type CSSProperties } from 'react'
import { FosShell } from '@/components/frameos/FosShell'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Clapperboard,
  Layers3,
  Loader2,
  RefreshCw,
  Video,
} from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import type { ResolvedSequenceSegment } from '@/lib/interactive/sequence'
import { coverMonogram, generativeCoverStyle } from '@/lib/ui/generative-cover'
import { CHAPTER_STATUS_LABEL, orderedChapters } from './story-overview-model'
import { StoryLayerNav } from './StoryLayerNav'
import { useStoryOverview } from './useStoryOverview'
import { workSequenceGroups } from './work-canvas-model'
import './interactive.css'

function SegmentRow({ item }: { item: ResolvedSequenceSegment }) {
  const href = item.canvasId
    ? `/canvas/${encodeURIComponent(item.segment.projectId)}/${encodeURIComponent(item.canvasId)}`
    : null
  return (
    <li className="nori-ix-prod-seg" data-testid="production-segment">
      <span className={`nori-ix-prod-dot is-${item.segment.branch ? 'branch' : item.segment.removed ? 'removed' : item.media ? 'ready' : 'empty'}`} aria-hidden="true" />
      <div>
        <strong>{item.segment.title || '未命名作品片段'}</strong>
        <span>
          {item.segment.branch ? '分支片段' : item.segment.removed ? '已从成片移除' : '线性片段'}
          {' · '}
          {item.media ? (item.media.kind === 'video' ? '已有视频' : '已有图片') : '素材待生成'}
        </span>
      </div>
      {href ? <Link href={href}>打开制作画布<ArrowUpRight /></Link> : <em>本章还没有画布</em>}
    </li>
  )
}

export function StoryProductionCanvas({ workId }: { workId: string }) {
  const overview = useStoryOverview(workId)
  const { data } = overview
  const groups = useMemo(() => (data ? workSequenceGroups(data) : null), [data])
  const chapters = useMemo(() => (data ? orderedChapters(data) : []), [data])
  const byProject = useMemo(() => {
    const map = new Map<string, ResolvedSequenceSegment[]>()
    for (const item of groups?.items ?? []) {
      const list = map.get(item.segment.projectId)
      if (list) list.push(item)
      else map.set(item.segment.projectId, [item])
    }
    return map
  }, [groups])

  if (!data || !groups) {
    return (
      <FosShell activeKey="interactive">
        <div className="nori-ix nori-ix-overview is-loading">
          {overview.loadError ? (
            <div className="nori-ix-empty is-error">
              <p>{overview.loadError}</p>
              <div>
                <Link href="/interactive" className="fos-btn fos-btn-ghost"><ArrowLeft />返回影游列表</Link>
                <button type="button" className="fos-btn fos-btn-ghost" onClick={() => void overview.reload()}><RefreshCw />重试</button>
              </div>
            </div>
          ) : <Loader2 className="nori-ix-spin" aria-label="加载中" />}
        </div>
      </FosShell>
    )
  }

  const { story } = data
  const isPortrait = story.aspectRatio === '9:16'
  const canvasCount = chapters.filter(({ chapter }) => chapter.canvasId).length

  return (
    <FosShell activeKey="interactive" titlebarTitle={story.name}>
      <div className="nori-ix nori-ix-production">
        <header className="nori-ix-ov-head">
          <Link href="/interactive" className="nori-ix-back" aria-label="返回影游列表"><ArrowLeft /></Link>
          <span className="nori-ix-ov-cover nori-gen-cover" style={generativeCoverStyle(story.workId) as CSSProperties} aria-hidden="true">
            <b>{coverMonogram(story.name)}</b>
          </span>
          <div className="nori-ix-ov-title">
            <h1>{story.name}</h1>
            <span>
              <i className={isPortrait ? 'is-portrait' : 'is-landscape'} aria-hidden="true" />
              制作画布 · {chapters.length} 章 · {canvasCount} 张现有画布
            </span>
          </div>
          <div className="nori-ix-ov-actions">
            <Link href={`/interactive/${encodeURIComponent(workId)}/works`} className="fos-btn fos-btn-ghost"><Layers3 />作品画布</Link>
          </div>
        </header>

        <StoryLayerNav workId={workId} active="production" />

        <main className="nori-ix-prod-body">
          <section className="nori-ix-work-intro">
            <div>
              <span className="nori-ix-eyebrow"><Clapperboard />制作画布</span>
              <h2>进入现有作品画布</h2>
              <p>每个作品片段都下钻到原来的作品画布。生成、模型配置与资产归属全部复用现有画布，不另造生成引擎，也不会在这里自动生成或导出。</p>
            </div>
            {groups.orphans.length ? (
              <div className="nori-ix-prod-warning" role="status">
                <AlertTriangle />
                <span>{groups.orphans.length} 个失效片段引用等待在作品画布处理。</span>
                <Link href={`/interactive/${encodeURIComponent(workId)}/works`}>去处理<ArrowUpRight /></Link>
              </div>
            ) : null}
          </section>

          <ol className="nori-ix-prod-list">
            {chapters.map(({ meta, chapter }) => {
              const segments = byProject.get(chapter.projectId) ?? []
              const linear = segments.filter((item) => !item.segment.branch && item.orphan === null).length
              const branches = segments.filter((item) => item.segment.branch && item.orphan === null).length
              return (
                <li key={chapter.projectId} className="nori-ix-prod-card" data-testid="production-chapter" data-project-id={chapter.projectId}>
                  <header>
                    <span className="nori-ix-prod-order">第 {meta.order + 1} 章</span>
                    <strong title={chapter.name}>{chapter.name}</strong>
                    <em className={`nori-ix-status is-${meta.status}`}>{CHAPTER_STATUS_LABEL[meta.status]}</em>
                  </header>
                  <div className="nori-ix-prod-meta">
                    <span>{chapter.nodeCount} 个节点</span>
                    <span>{linear} 个线性片段</span>
                    <span>{branches} 个分支片段</span>
                  </div>
                  {segments.length ? (
                    <ul className="nori-ix-prod-segs">
                      {segments.map((item) => <SegmentRow key={item.segment.id} item={item} />)}
                    </ul>
                  ) : <p className="nori-ix-prod-empty">本章还没有剧情片段，先在剧情画布中连接场景。</p>}
                  <footer>
                    {chapter.canvasId ? (
                      <Link className="fos-btn fos-btn-primary" href={`/canvas/${encodeURIComponent(chapter.projectId)}/${encodeURIComponent(chapter.canvasId)}`}>
                        <Video />打开本章制作画布
                      </Link>
                    ) : <span className="nori-ix-prod-nocanvas">本章还没有画布</span>}
                    <Link className="fos-btn fos-btn-ghost" href={`/interactive/${encodeURIComponent(workId)}`}><ArrowLeft />剧情画布</Link>
                  </footer>
                </li>
              )
            })}
          </ol>
        </main>
      </div>
    </FosShell>
  )
}
