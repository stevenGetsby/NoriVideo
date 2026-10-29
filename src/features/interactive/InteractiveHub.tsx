'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { FosShell } from '@/components/frameos/FosShell'
import { Clock3, GitBranch, Layers3, Plus, RefreshCw } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { storyErrorMessage } from './story-api-error'
import type { StoryAspectRatio, StoryResolution } from '@/lib/interactive/types'
import { coverMonogram, generativeCoverStyle } from '@/lib/ui/generative-cover'
import { CreateStoryDialog } from './CreateStoryDialog'
import './interactive.css'

type StorySummary = {
  workId: string
  name: string
  aspectRatio: StoryAspectRatio
  resolution: StoryResolution
  chapterCount: number
  updatedAt: string
}

const STEPS = [
  { title: '分章搭建', text: '每一章是一个作品，在无限画布里用入口、剧情、选择、条件、出口串起来。' },
  { title: '变量与条件', text: '全局变量跨章节生效，选项改变数值，条件节点按数值把观众送往不同支线。' },
  { title: '随时试玩', text: '单章试玩带变量预设，全剧试玩沿章节连线一路走到结局。' },
]

function formatUpdated(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}月${date.getDate()}日更新`
}

export function InteractiveHub() {
  const [stories, setStories] = useState<StorySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    void apiFetch('/api/interactive', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await storyErrorMessage(response, '加载影游失败'))
        const payload = await response.json() as { stories: StorySummary[] }
        setStories(payload.stories)
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return
        setStories([])
        setError(loadError instanceof Error ? loadError.message : '加载影游失败')
      })
    return () => controller.abort()
  }, [reloadKey])

  return (
    <FosShell activeKey="interactive">
      <div className="fos-scroll nori-ix nori-ix-hub">
        <header className="nori-ix-hero">
          <div className="nori-ix-hero-copy">
            <span className="nori-ix-eyebrow"><GitBranch />影游画布</span>
            <h1>把故事做成观众能参与的影像</h1>
            <p>在无限画布上分章节编排剧情分支，用全局变量记住观众的每一次选择。</p>
          </div>
          <button type="button" className="fos-btn fos-btn-primary fos-btn-lg" onClick={() => setCreating(true)}><Plus />新建影游</button>
          <ol className="nori-ix-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}><b>{String(index + 1).padStart(2, '0')}</b><strong>{step.title}</strong><span>{step.text}</span></li>
            ))}
          </ol>
        </header>

        <section className="nori-ix-section" aria-label="我的影游">
          <div className="nori-ix-section-head">
            <h2>我的影游</h2>
            {stories?.length ? <span>{stories.length} 个</span> : null}
          </div>
          {error ? (
            <div className="nori-ix-empty is-error">
              <p>{error}</p>
              <button type="button" className="fos-btn fos-btn-ghost" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw />重试</button>
            </div>
          ) : stories === null ? (
            <div className="nori-ix-grid" aria-busy="true">
              {[0, 1, 2].map((index) => <div key={index} className="nori-ix-card is-skeleton" />)}
            </div>
          ) : stories.length === 0 ? (
            <div className="nori-ix-empty">
              <strong>还没有影游</strong>
              <p>新建一个影游，选择竖屏或横屏，第一章的画布会自动带好入口节点。</p>
              <button type="button" className="fos-btn fos-btn-primary" onClick={() => setCreating(true)}><Plus />新建影游</button>
            </div>
          ) : (
            <ul className="nori-ix-grid">
              {stories.map((story) => (
                <li key={story.workId}>
                  <Link href={`/interactive/${encodeURIComponent(story.workId)}`} className="nori-ix-card" style={generativeCoverStyle(story.workId) as CSSProperties}>
                    <span className={`nori-ix-card-cover nori-gen-cover is-${story.aspectRatio === '9:16' ? 'portrait' : 'landscape'}`}>
                      <span className="nori-ix-card-monogram" aria-hidden="true">{coverMonogram(story.name)}</span>
                      <span className="nori-ix-card-frame" aria-hidden="true" />
                      <span className="nori-ix-card-format">{story.aspectRatio === '9:16' ? '竖屏' : '横屏'} · {story.resolution}</span>
                    </span>
                    <span className="nori-ix-card-info">
                      <strong>{story.name}</strong>
                      <span className="nori-ix-card-meta">
                        <span><Layers3 />{story.chapterCount} 章</span>
                        <span><Clock3 />{formatUpdated(story.updatedAt)}</span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {creating ? <CreateStoryDialog onClose={() => setCreating(false)} /> : null}
    </FosShell>
  )
}
