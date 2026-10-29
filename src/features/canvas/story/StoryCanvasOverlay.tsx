'use client'

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@xyflow/react'
import { AlertTriangle, ArrowUpRight, CheckCircle2, LayoutGrid, Play, SlidersHorizontal, Sparkles, X } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import { compileChapter, isStoryNodeType } from '@/lib/interactive/compile'
import type { StoryChapterGraph, StoryProgram } from '@/lib/interactive/types'
import { countIssues, validateChapter } from '@/lib/interactive/validate'
import { InteractivePlayer } from '@/features/interactive/InteractivePlayer'
import { StoryVariablesEditor } from '@/features/interactive/StoryVariablesEditor'
import { useStoryCanvasContext, type StoryCanvasContextValue } from './StoryCanvasContext'

/** The chapter as the player sees it, recompiled only when story-relevant content changes. */
function useLiveChapter(projectId: string, title: string): StoryChapterGraph {
  const json = useStore((state) => JSON.stringify(compileChapter(
    { projectId, title },
    state.nodes.map((node) => ({ id: node.id, type: node.type ?? '', data: node.data })),
    state.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, role: (edge.data as { role?: string } | undefined)?.role })),
  )))
  return useMemo(() => JSON.parse(json) as StoryChapterGraph, [json])
}

const TIPS_KEY = 'nori.story.tips.v1'
const TIPS = [
  { title: '接下来发生什么', text: '点卡片右侧的 +，或从圆点拖出连线，选择下一步' },
  { title: '片段的画面', text: '剧情片段顶部的方形接口连接视频或图片，空片段可一键生成' },
  { title: '分支与条件', text: '选择的每个选项、条件的每条分支都有自己的出口，分别接到不同剧情' },
]

/** First-run guide for a near-empty chapter; it retires itself once dismissed or the chapter grows. */
function StoryTips() {
  const sparse = useStore((state) => state.nodes.filter((node) => isStoryNodeType(node.type)).length <= 3)
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => { setDismissed(window.localStorage.getItem(TIPS_KEY) === '1') }, [])
  if (dismissed || !sparse) return null
  const dismiss = () => { window.localStorage.setItem(TIPS_KEY, '1'); setDismissed(true) }
  return (
    <aside className="nori-story-tips" aria-label="影游画布上手提示">
      <header><Sparkles /><strong>三步搭起一段互动剧情</strong><button type="button" aria-label="关闭提示" onClick={dismiss}><X /></button></header>
      <ol>
        {TIPS.map((tip, index) => <li key={tip.title}><b>{index + 1}</b><span><strong>{tip.title}</strong>{tip.text}</span></li>)}
      </ol>
      <footer><span>「整理剧情」会按剧情走向自动排版</span><button type="button" onClick={dismiss}>知道了</button></footer>
    </aside>
  )
}

function Overlay({ story, onFocusNode }: { story: StoryCanvasContextValue; onFocusNode: (nodeId: string) => void }) {
  const chapterName = story.story.chapters.find((chapter) => chapter.projectId === story.projectId)?.name || '本章'
  const chapter = useLiveChapter(story.projectId, chapterName)
  const issues = useMemo(() => validateChapter(chapter, story.variables), [chapter, story.variables])
  const { errors, warnings } = countIssues(issues)
  const program = useMemo<StoryProgram>(() => ({ variables: story.variables, chapters: [chapter], links: [], start: null }), [chapter, story.variables])
  const togglePanel = (panel: 'variables' | 'checks') => story.setPanel(story.panel === panel ? null : panel)

  return (
    <>
      <div className="nori-story-bar" role="toolbar" aria-label="影游章节工具">
        <span className="nori-story-bar-title"><i />影游<strong>{story.story.name}</strong><small>{chapterName}</small></span>
        <span className="nori-story-bar-format">{story.story.aspectRatio === '9:16' ? '竖屏' : '横屏'} · {story.story.resolution}</span>
        {story.readOnly ? null : <button type="button" title="按剧情走向自动排版" onClick={story.actions.organize}><LayoutGrid />整理剧情</button>}
        <button type="button" className={story.panel === 'variables' ? 'is-open' : ''} onClick={() => togglePanel('variables')}>
          <SlidersHorizontal />全局变量<b>{story.variables.length}</b>
        </button>
        <button type="button" className={`${story.panel === 'checks' ? 'is-open ' : ''}${errors ? 'is-error' : warnings ? 'is-warning' : 'is-ok'}`} onClick={() => togglePanel('checks')}>
          {errors || warnings ? <AlertTriangle /> : <CheckCircle2 />}
          {errors ? `${errors} 个问题` : warnings ? `${warnings} 个提醒` : '检查通过'}
        </button>
        <button type="button" className="is-primary" onClick={() => story.openTrial(null)}><Play />试玩本章</button>
        <Link href={`/interactive/${story.story.workId}`} className="nori-story-bar-link">故事总览<ArrowUpRight /></Link>
      </div>

      {story.readOnly ? null : <StoryTips />}

      {story.panel === 'variables' ? (
        <section className="nori-story-panel" aria-label="全局变量">
          <header><strong>全局变量</strong><button type="button" aria-label="关闭" onClick={() => story.setPanel(null)}><X /></button></header>
          <StoryVariablesEditor key={JSON.stringify(story.variables)} variables={story.variables} readOnly={story.readOnly} onSave={story.saveVariables} />
        </section>
      ) : null}

      {story.panel === 'checks' ? (
        <section className="nori-story-panel" aria-label="本章检查">
          <header><strong>本章检查</strong><button type="button" aria-label="关闭" onClick={() => story.setPanel(null)}><X /></button></header>
          {issues.length === 0 ? <p className="nori-story-checks-ok"><CheckCircle2 />本章没有发现问题，可以试玩。</p> : (
            <ul className="nori-story-checks">
              {issues.map((issue, index) => (
                <li key={`${issue.code}:${issue.nodeId}:${index}`} className={`is-${issue.level}`}>
                  <button type="button" disabled={!issue.nodeId} onClick={() => issue.nodeId && onFocusNode(issue.nodeId)}>
                    <span>{issue.level === 'error' ? '问题' : '提醒'}</span>{issue.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="nori-story-checks-foot">跨章节的出口、入口与结局检查在故事总览中进行。</p>
        </section>
      ) : null}

      {story.trialEntryId !== undefined ? (
        <InteractivePlayer
          program={program}
          mode="chapter"
          aspectRatio={story.story.aspectRatio}
          title={`${story.story.name} · ${chapterName}`}
          projectId={story.projectId}
          entryNodeId={story.trialEntryId}
          onClose={story.closeTrial}
          onLocate={(_projectId, nodeId) => onFocusNode(nodeId)}
        />
      ) : null}
    </>
  )
}

export function StoryCanvasOverlay({ onFocusNode }: { onFocusNode: (nodeId: string) => void }) {
  const story = useStoryCanvasContext()
  return story ? <Overlay story={story} onFocusNode={onFocusNode} /> : null
}
