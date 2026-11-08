'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { useSession } from 'next-auth/react'
import { FosShell } from '@/components/frameos/FosShell'
import { MediaImage } from '@/components/media/MediaImage'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Clapperboard,
  ImageIcon,
  Layers3,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  Video,
  X,
} from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { moveSequenceSegment, type ResolvedSequenceSegment } from '@/lib/interactive/sequence'
import type { StorySequenceSegment } from '@/lib/interactive/types'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { coverMonogram, generativeCoverStyle } from '@/lib/ui/generative-cover'
import { SequencePreview } from './SequencePreview'
import { StoryLayerNav } from './StoryLayerNav'
import { ensuredWorkSequence, withWorkSequence, workSequenceGroups } from './work-canvas-model'
import { useStoryOverview } from './useStoryOverview'
import './interactive.css'

const quiet = (promise: Promise<void>) => { void promise.catch(() => undefined) }
const display = (url: string | null | undefined) => (url ? toDisplayImageUrl(url) || url : null)

function mediaLabel(item: ResolvedSequenceSegment) {
  if (!item.media) return '素材待生成'
  return item.media.kind === 'video' ? '视频片段' : '图片片段'
}

function SequenceThumb({ item }: { item: ResolvedSequenceSegment }) {
  const poster = display(item.media?.posterUrl ?? (item.media?.kind === 'image' ? item.media.url : null))
  return (
    <span className={`nori-ix-seg-thumb is-${item.media?.kind ?? 'empty'}`} aria-hidden="true">
      {poster ? <MediaImage src={poster} alt="" fill sizes="160px" draggable={false} /> : item.media?.kind === 'video' ? <Video /> : item.media?.kind === 'image' ? <ImageIcon /> : <Clapperboard />}
    </span>
  )
}

export function StoryWorksCanvas({ workId }: { workId: string }) {
  const overview = useStoryOverview(workId)
  const { data, patch } = overview
  const { data: session } = useSession()
  const readOnly = !hasAccountPermissions(session?.user || {}, ['canvasWrite'])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [confirmOrphanId, setConfirmOrphanId] = useState<string | null>(null)

  const groups = useMemo(() => (data ? workSequenceGroups(data) : null), [data])
  const baseSequence = useMemo(() => (data ? ensuredWorkSequence(data) : null), [data])

  if (!data || !groups || !baseSequence) {
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
  const { stats, cut, branch, removed, orphans } = groups
  const isPortrait = story.aspectRatio === '9:16'
  const cutIds = cut.map((item) => item.segment.id)

  const saveSequence = (segments: StorySequenceSegment[]) => {
    const sequence = { segments }
    quiet(patch({ config: { sequence } }, (current) => withWorkSequence(current, sequence)))
  }
  const move = (item: ResolvedSequenceSegment, direction: -1 | 1) => {
    const next = moveSequenceSegment(baseSequence.segments, item.segment.id, direction, cutIds)
    if (next !== baseSequence.segments) saveSequence(next)
  }
  const setRemoved = (item: ResolvedSequenceSegment, value: boolean) => {
    saveSequence(baseSequence.segments.map((segment) => (segment.id === item.segment.id ? { ...segment, removed: value } : segment)))
  }
  const dropOrphan = (item: ResolvedSequenceSegment) => {
    saveSequence(baseSequence.segments.filter((segment) => segment.id !== item.segment.id))
    setConfirmOrphanId(null)
  }

  return (
    <FosShell activeKey="interactive" titlebarTitle={story.name}>
      <div className="nori-ix nori-ix-works">
        <header className="nori-ix-ov-head">
          <Link href="/interactive" className="nori-ix-back" aria-label="返回影游列表"><ArrowLeft /></Link>
          <span className="nori-ix-ov-cover nori-gen-cover" style={generativeCoverStyle(story.workId) as CSSProperties} aria-hidden="true">
            <b>{coverMonogram(story.name)}</b>
          </span>
          <div className="nori-ix-ov-title">
            <h1>{story.name}</h1>
            <span>
              <i className={isPortrait ? 'is-portrait' : 'is-landscape'} aria-hidden="true" />
              作品画布 · {isPortrait ? '竖屏' : '横屏'} {story.aspectRatio} · {cut.length} 个线性片段
            </span>
          </div>
          <div className="nori-ix-ov-actions">
            <span className={`nori-ix-save-state${overview.saving ? ' is-saving' : ''}`} aria-live="polite">
              {overview.saving ? '保存中…' : '已同步'}
            </span>
            <button
              type="button"
              className="fos-btn fos-btn-primary"
              disabled={!cut.length}
              title={cut.length ? '按线性顺序播放现有素材' : '还没有可预览的线性片段'}
              onClick={() => setPreviewOpen(true)}
            >
              <Play />预览成片
            </button>
          </div>
        </header>

        <StoryLayerNav workId={workId} active="works" />

        {overview.saveError ? (
          <div className="nori-ix-banner" role="alert">
            {overview.saveError}
            <button type="button" aria-label="关闭提示" onClick={overview.dismissError}><X /></button>
          </div>
        ) : null}

        <div className="nori-ix-works-body">
          <main className="nori-ix-works-main">
            <section className="nori-ix-work-intro">
              <div>
                <span className="nori-ix-eyebrow"><Layers3 />作品画布</span>
                <h2>线性成片</h2>
                <p>按顺序播放每一段作品级大视频片段。分支片段留在剧情画布里，不会混入这条成片线。</p>
              </div>
              <div className="nori-ix-work-stats" aria-label="片段统计">
                <span><b>{stats.cut}</b>成片段落</span>
                <span><b>{stats.ready}</b>有素材</span>
                <span><b>{stats.branch}</b>分支片段</span>
                {stats.removed ? <span><b>{stats.removed}</b>已移除</span> : null}
                {stats.orphaned ? <span className="is-error"><b>{stats.orphaned}</b>失效引用</span> : null}
              </div>
            </section>

            {cut.length ? (
              <ol className="nori-ix-cut-list" data-testid="linear-cut">
                {cut.map((item, index) => (
                  <li key={item.segment.id} className="nori-ix-seg" data-testid="linear-segment" data-segment-id={item.segment.id}>
                    <span className="nori-ix-seg-order">{String(index + 1).padStart(2, '0')}</span>
                    <SequenceThumb item={item} />
                    <div className="nori-ix-seg-info">
                      <strong title={item.segment.title}>{item.segment.title || '未命名作品片段'}</strong>
                      <span>{item.chapterName || '章节已删除'} · {mediaLabel(item)}</span>
                    </div>
                    <div className="nori-ix-seg-actions">
                      <button type="button" aria-label={`上移 ${item.segment.title || '片段'}`} title="上移" disabled={readOnly || index === 0} onClick={() => move(item, -1)}>↑</button>
                      <button type="button" aria-label={`下移 ${item.segment.title || '片段'}`} title="下移" disabled={readOnly || index === cut.length - 1} onClick={() => move(item, 1)}>↓</button>
                      <button type="button" className="is-quiet" disabled={readOnly} onClick={() => setRemoved(item, true)}><Trash2 />移除</button>
                      {item.canvasId ? (
                        <Link className="nori-ix-seg-canvas" href={`/canvas/${encodeURIComponent(item.segment.projectId)}/${encodeURIComponent(item.canvasId)}`}>
                          制作画布<ArrowUpRight />
                        </Link>
                      ) : <span className="nori-ix-seg-canvas is-disabled">无画布</span>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="nori-ix-empty nori-ix-work-empty">
                <Clapperboard />
                <strong>还没有线性片段</strong>
                <p>在剧情画布中连接入口、剧情片段和出口后，这里会按章节顺序派生作品片段。</p>
                <Link href={`/interactive/${encodeURIComponent(workId)}`} className="fos-btn fos-btn-primary"><ArrowLeft />去剧情画布</Link>
              </div>
            )}

            {removed.length ? (
              <section className="nori-ix-work-section" aria-label="已移除片段">
                <header><h3>已移除片段</h3><span>仍保留在配置里，可随时恢复</span></header>
                <ul>
                  {removed.map((item) => (
                    <li key={item.segment.id} className="nori-ix-seg is-removed" data-testid="removed-segment">
                      <SequenceThumb item={item} />
                      <div className="nori-ix-seg-info"><strong>{item.segment.title || '未命名作品片段'}</strong><span>{item.chapterName}</span></div>
                      <button type="button" className="is-restore" disabled={readOnly} onClick={() => setRemoved(item, false)}><RotateCcw />恢复到成片</button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {orphans.length ? (
              <section className="nori-ix-work-section is-warning" aria-label="失效片段引用">
                <header><h3><AlertTriangle />失效引用</h3><span>原章节或剧情片段已删除；先确认再清理，不会静默丢弃</span></header>
                <ul>
                  {orphans.map((item) => (
                    <li key={item.segment.id} className="nori-ix-seg is-orphan" data-testid="orphan-segment">
                      <span className="nori-ix-seg-thumb is-empty"><AlertTriangle /></span>
                      <div className="nori-ix-seg-info">
                        <strong>{item.segment.title || '未命名作品片段'}</strong>
                        <span>{item.orphan === 'project' ? '所属章节已删除' : '关联的剧情片段已删除'}</span>
                      </div>
                      {confirmOrphanId === item.segment.id ? (
                        <div className="nori-ix-seg-actions">
                          <button type="button" className="is-danger" disabled={readOnly} onClick={() => dropOrphan(item)}>确认移除</button>
                          <button type="button" onClick={() => setConfirmOrphanId(null)}>取消</button>
                        </div>
                      ) : (
                        <button type="button" className="is-quiet" disabled={readOnly} onClick={() => setConfirmOrphanId(item.segment.id)}><Trash2 />移除引用</button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {branch.length ? (
              <section className="nori-ix-work-section is-branch" aria-label="分支片段">
                <header><h3><CheckCircle2 />分支片段</h3><span>保留在剧情画布中，不进入线性成片</span></header>
                <ul>
                  {branch.map((item) => (
                    <li key={item.segment.id} className="nori-ix-branch-item" data-testid="branch-segment">
                      <span className="nori-ix-seg-tag">分支</span>
                      <strong>{item.segment.title || '未命名作品片段'}</strong>
                      <small>{item.chapterName}</small>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </main>

          <aside className="nori-ix-work-side">
            <section className="nori-ix-work-card">
              <h3>三层怎么走</h3>
              <ol>
                <li><b>剧情画布</b><span>用入口、场景、条件、选项和分支把故事连起来，每个场景就是一个作品级片段。</span></li>
                <li><b>作品画布</b><span>在这里排序线性片段并预览成片；分支片段不会混入。</span></li>
                <li><b>制作画布</b><span>下钻到现有作品画布生成与替换素材，资产归属不变。</span></li>
              </ol>
              <div className="nori-ix-work-links">
                <Link href={`/interactive/${encodeURIComponent(workId)}`}><ArrowLeft />剧情画布</Link>
                <Link href={`/interactive/${encodeURIComponent(workId)}/production`}>制作画布<ArrowUpRight /></Link>
              </div>
            </section>
            <section className="nori-ix-work-card">
              <h3>成片规则</h3>
              <ul className="nori-ix-rules">
                <li>只按这里的顺序播放线性片段，不重新渲染、不拼接文件。</li>
                <li>没有素材的片段会明确提示，可在制作画布补齐。</li>
                <li>移除片段会进入「已移除」区，可恢复。</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
      {previewOpen ? (
        <SequencePreview items={cut} title={story.name} aspectRatio={story.aspectRatio} onClose={() => setPreviewOpen(false)} />
      ) : null}
    </FosShell>
  )
}
