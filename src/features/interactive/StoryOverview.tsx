'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { useSession } from 'next-auth/react'
import type { Connection } from '@xyflow/react'
import { FosShell } from '@/components/frameos/FosShell'
import { ArrowLeft, Loader2, Play, Plus, RefreshCw, X } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import { hasAccountPermissions } from '@/lib/account/permissions'
import type { StoryChapterMeta, StoryIssue } from '@/lib/interactive/types'
import { validateStory } from '@/lib/interactive/validate'
import { coverMonogram, generativeCoverStyle } from '@/lib/ui/generative-cover'
import { InteractivePlayer } from './InteractivePlayer'
import { StoryChapterMap } from './StoryChapterMap'
import type { ChapterMapActions } from './StoryChapterNode'
import { StoryOverviewSide } from './StoryOverviewSide'
import { buildStoryProgram, connectChapters, readChapterConnection, withConfig } from './story-overview-model'
import { useStoryOverview } from './useStoryOverview'
import './interactive.css'

const quiet = (promise: Promise<void>) => { void promise.catch(() => undefined) }

export function StoryOverview({ workId }: { workId: string }) {
  const overview = useStoryOverview(workId)
  const { data, patch } = overview
  const { data: session } = useSession()
  const readOnly = !hasAccountPermissions(session?.user || {}, ['canvasWrite'])
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [trial, setTrial] = useState(false)
  const program = useMemo(() => (data ? buildStoryProgram(data) : null), [data])
  const issues = useMemo(() => (program ? validateStory(program) : []), [program])

  if (!data || !program) {
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
  const { config } = story
  const saveChapters = (update: (chapter: StoryChapterMeta) => StoryChapterMeta) => {
    const chapters = config.chapters.map(update)
    quiet(patch({ config: { chapters } }, (current) => withConfig(current, { chapters })))
  }
  const actions: ChapterMapActions = {
    readOnly,
    start: config.start,
    onStatus: (projectId, status) => saveChapters((chapter) => (chapter.projectId === projectId ? { ...chapter, status } : chapter)),
    onSetStart: (projectId, entryNodeId) => {
      const start = { projectId, entryNodeId }
      quiet(patch({ config: { start } }, (current) => withConfig(current, { start })))
    },
  }
  const connect = (connection: Connection) => {
    const link = readChapterConnection(connection)
    const links = link ? connectChapters(config.links, link, `l_${crypto.randomUUID().slice(0, 8)}`) : null
    if (links) quiet(patch({ config: { links } }, (current) => withConfig(current, { links })))
  }
  const deleteLinks = (ids: string[]) => {
    const links = config.links.filter((link) => !ids.includes(link.id))
    if (links.length !== config.links.length) quiet(patch({ config: { links } }, (current) => withConfig(current, { links })))
  }
  const focusIssue = (issue: StoryIssue) => { if (issue.projectId) setFocusedId(issue.projectId) }
  const addChapter = async () => {
    const projectId = await overview.createChapter()
    if (projectId) setFocusedId(projectId)
  }
  const isPortrait = story.aspectRatio === '9:16'

  return (
    <FosShell activeKey="interactive" titlebarTitle={story.name}>
      <div className="nori-ix nori-ix-overview">
        <header className="nori-ix-ov-head">
          <Link href="/interactive" className="nori-ix-back" aria-label="返回影游列表"><ArrowLeft /></Link>
          <span className="nori-ix-ov-cover nori-gen-cover" style={generativeCoverStyle(story.workId) as CSSProperties} aria-hidden="true">
            <b>{coverMonogram(story.name)}</b>
          </span>
          <div className="nori-ix-ov-title">
            <h1>{story.name}</h1>
            <span>
              <i className={isPortrait ? 'is-portrait' : 'is-landscape'} aria-hidden="true" />
              {isPortrait ? '竖屏' : '横屏'} {story.aspectRatio} · {story.resolution} · {data.chapters.length} 章 · {config.variables.length} 个变量
            </span>
          </div>
          <div className="nori-ix-ov-actions">
            <span className={`nori-ix-save-state${overview.saving ? ' is-saving' : ''}`} aria-live="polite">
              {overview.saving ? '保存中…' : '已同步'}
            </span>
            {story.canCreateChapters && !readOnly ? (
              <button type="button" className="fos-btn fos-btn-ghost" disabled={overview.creatingChapter} onClick={() => void addChapter()}>
                {overview.creatingChapter ? <Loader2 className="nori-ix-spin" /> : <Plus />}新建章节
              </button>
            ) : null}
            <button type="button" className="fos-btn fos-btn-primary" onClick={() => setTrial(true)}><Play />全剧试玩</button>
          </div>
        </header>
        {overview.saveError ? (
          <div className="nori-ix-banner" role="alert">
            {overview.saveError}
            <button type="button" aria-label="关闭提示" onClick={overview.dismissError}><X /></button>
          </div>
        ) : null}
        <div className="nori-ix-ov-body">
          <StoryChapterMap
            data={data}
            issues={issues}
            focusedId={focusedId}
            actions={actions}
            onConnect={connect}
            onDeleteLinks={deleteLinks}
            onMove={(projectId, position) => saveChapters((chapter) => (chapter.projectId === projectId ? { ...chapter, position } : chapter))}
            onFocus={setFocusedId}
          />
          <StoryOverviewSide story={story} issues={issues} readOnly={readOnly} onFocusIssue={focusIssue} onSave={(body) => patch(body)} />
        </div>
      </div>
      {trial ? (
        <InteractivePlayer
          program={program}
          mode="story"
          aspectRatio={story.aspectRatio}
          title={story.name}
          onClose={() => setTrial(false)}
          onLocate={(projectId) => { setTrial(false); setFocusedId(projectId) }}
        />
      ) : null}
    </FosShell>
  )
}
