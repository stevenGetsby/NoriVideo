'use client'

import { memo, useState } from 'react'
import { useStore, type NodeProps } from '@xyflow/react'
import { MediaImage } from '@/components/media/MediaImage'
import { Film, Play } from '@/components/ui/icons'
import { SceneTextEditor } from '@/features/interactive/SceneTextEditor'
import { requestStoryGameplaySegment } from '@/features/interactive/StoryGameplaySettings'
import { achievementId } from '@/features/interactive/gameplay-edit'
import { endingAchievementOf, toggleEndingAchievement } from '@/lib/interactive/achievements'
import { readEndingData, readSceneData, resolveSceneMedia, STORY_ENDING_LABEL, STORY_SAVE_POINT_NAME_MAX } from '@/lib/interactive/compile'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { STORY_ENDING_TYPES, STORY_FLOW_ROLE, type StoryEndingType } from '@/lib/interactive/types'
import { STORY_MEDIA_SOURCE_TYPES } from './story-connection'
import { StoryBeatTimeline } from './StoryBeatTimeline'
import { StoryEffectsSection } from './StoryFields'
import { StoryImageField } from './StoryImageField'
import { StoryNodeShell, useStoryNodeEditing } from './StoryNodeShell'

const titleOf = (data: NodeProps['data']) => (typeof data?.title === 'string' ? data.title : '')

export const StoryEntryNode = memo(function StoryEntryNode({ id, data, selected }: NodeProps) {
  const { story } = useStoryNodeEditing(id)
  const isStart = story?.story.config.start?.entryNodeId === id
  return (
    <StoryNodeShell id={id} type="story_entry" selected={selected} title={titleOf(data)} input={false} output
      badge={isStart ? <span className="nori-story-node-kind is-accent">故事起点</span> : undefined}>
      <button type="button" className="nori-story-trial-button nodrag" disabled={!story} onClick={() => story?.openTrial(id)}>
        <Play />从这里试玩本章
      </button>
    </StoryNodeShell>
  )
})

type ServerStatus = { __server?: { status?: string } }

/**
 * A compact production-status row. Media and generation are deliberately not
 * part of the writing card: the script is text, and pictures are produced in
 * the production layer (or wired in from a video/image node on the canvas).
 * The selector returns a string so the card only re-renders when the picture
 * itself changes, not when other nodes move.
 */
function SceneMediaStatus({ id, data }: { id: string; data: NodeProps['data'] }) {
  const { readOnly, story } = useStoryNodeEditing(id)
  const key = useStore((state) => {
    const linked = state.edges
      .filter((edge) => edge.target === id && edge.data?.role !== STORY_FLOW_ROLE)
      .flatMap((edge) => {
        const node = state.nodeLookup.get(edge.source)
        return node ? [{ id: node.id, type: node.type ?? '', data: node.data }] : []
      })
    const edges = linked.map((node) => ({ id: `${node.id}>${id}`, source: node.id, target: id }))
    const media = resolveSceneMedia(id, data, linked, edges)
    if (media) return ['ready', media.kind, media.url, media.posterUrl ?? ''].join('\n')
    const pending = linked.find((node) => STORY_MEDIA_SOURCE_TYPES.has(node.type))
    return pending ? ['pending', pending.id, (pending.data as ServerStatus).__server?.status ?? ''].join('\n') : ''
  })
  const [state, first = '', second = '', third = ''] = key.split('\n')

  if (state === 'ready') {
    const displayPoster = toDisplayImageUrl(third || null)
    const stream = toDisplayImageUrl(second) || second
    return (
      <div className="nori-story-scene-media-strip is-ready">
        <span className="nori-story-scene-media-thumb" aria-hidden="true">
          {first === 'video' && !displayPoster
            ? <video src={stream} muted playsInline preload="metadata" />
            : <MediaImage src={displayPoster || stream} alt="" draggable={false} fill sizes="42px" />}
        </span>
        <span className="nori-story-scene-media-copy">
          <strong>{first === 'video' ? '视频画面' : '图片画面'}</strong>
          <small>画面属于制作层，文字仍是主稿</small>
        </span>
      </div>
    )
  }

  if (state === 'pending') {
    const running = second === 'RUNNING'
    const failed = second === 'FAILED'
    return (
      <div className={`nori-story-scene-media-strip is-pending${failed ? ' is-failed' : ''}`}>
        <Film />
        <span className="nori-story-scene-media-copy">
          <strong>{running ? '画面生成中…' : failed ? '画面生成失败' : '画面还没有生成'}</strong>
          <small>制作层状态，不影响文字编辑</small>
        </span>
        {readOnly || !story ? null : (
          <button type="button" className="nodrag" onClick={() => story.actions.focusNode(first)}>
            {running ? '查看' : failed ? '去处理' : '去生成'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="nori-story-scene-media-strip is-empty">
      <Film />
      <span className="nori-story-scene-media-copy">
        <strong>文字片段</strong>
        <small>需要画面时，在制作层连接视频或图片节点</small>
      </span>
    </div>
  )
}

const rawRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null

/** A compact save point row: the box, and — while it is ticked — a name and a cover picture. */
function SceneSavePointSection({ id, data, readOnly, patch, mapEnabled, workId, fallbackName }: {
  id: string
  data: NodeProps['data']
  readOnly: boolean
  patch: (patch: Record<string, unknown>, label?: string) => void
  mapEnabled: boolean
  workId: string | null
  fallbackName: string
}) {
  const raw = rawRecord(data?.savePoint)
  const enabled = raw?.enabled === true
  const name = typeof raw?.name === 'string' ? raw.name : ''
  const coverUrl = typeof raw?.coverUrl === 'string' && raw.coverUrl ? raw.coverUrl : null
  const write = (next: { enabled: boolean; name: string; coverUrl: string | null }, label: string) => patch({ savePoint: next }, label)
  return (
    <section className={`nori-story-save-point${enabled ? ' is-on' : ''}`} aria-label="存档点">
      <div className="nori-story-save-point-head">
        <label className="nori-story-check nodrag">
          <input type="checkbox" checked={enabled} disabled={readOnly} aria-label="存档点"
            onChange={(event) => write({ enabled: event.target.checked, name, coverUrl }, '设置存档点')} />
          <span>存档点</span>
        </label>
        {enabled ? (
          <StoryImageField compact label="存档点封面" value={coverUrl} workId={workId} readOnly={readOnly}
            onChange={(url) => write({ enabled, name, coverUrl: url }, '更换存档点封面')} />
        ) : null}
      </div>
      {enabled ? (
        <input
          className="nodrag nori-story-input"
          value={name}
          placeholder={fallbackName}
          maxLength={STORY_SAVE_POINT_NAME_MAX}
          readOnly={readOnly}
          aria-label="存档点名称"
          onChange={(event) => write({ enabled, name: event.target.value, coverUrl }, '重命名存档点')}
        />
      ) : null}
      {mapEnabled ? null : <small className="nori-story-note nori-ix-warning">地图未开启，存档点暂不生效</small>}
    </section>
  )
}

export const StorySceneNode = memo(function StorySceneNode({ id, data, selected }: NodeProps) {
  const { readOnly, variables, manageVariables, story, patch } = useStoryNodeEditing(id)
  const scene = readSceneData(data)
  return (
    <StoryNodeShell id={id} type="story_scene" selected={selected} title={titleOf(data)} output media interact className="is-writing">
      <SceneTextEditor
        value={scene.lines}
        readOnly={readOnly}
        testId="scene-text-editor"
        onChange={(lines) => patch({ lines })}
      />
      <StoryEffectsSection effects={scene.effects} variables={variables} disabled={readOnly} onManageVariables={manageVariables}
        onChange={(effects) => patch({ effects }, '编辑剧情效果')} />
      <SceneSavePointSection
        id={id}
        data={data}
        readOnly={readOnly}
        patch={patch}
        mapEnabled={story?.story.config.map?.enabled === true}
        workId={story?.story.workId ?? null}
        fallbackName={titleOf(data).trim() || '剧情片段'}
      />
      <StoryBeatTimeline sceneId={id} />
      <SceneMediaStatus id={id} data={data} />
    </StoryNodeShell>
  )
})

export const StoryExitNode = memo(function StoryExitNode({ id, data, selected }: NodeProps) {
  const { story } = useStoryNodeEditing(id)
  const link = story?.story.config.links.find((item) => item.fromProjectId === story.projectId && item.exitNodeId === id)
  const target = link ? story?.story.chapters.find((chapter) => chapter.projectId === link.toProjectId) : null
  return (
    <StoryNodeShell id={id} type="story_exit" selected={selected} title={titleOf(data)}>
      <p className={`nori-story-note${target ? ' is-linked' : ''}`}>
        {target ? `下一章：${target.name}` : '在故事总览中把出口连到下一章入口'}
      </p>
    </StoryNodeShell>
  )
})

export const StoryEndingNode = memo(function StoryEndingNode({ id, data, selected }: NodeProps) {
  const { readOnly, patch, story } = useStoryNodeEditing(id)
  const ending = readEndingData(data)
  const achievements = story?.story.config.achievements
  const achievement = story ? endingAchievementOf(achievements, story.projectId, id) : undefined
  const personalityOn = story?.story.config.personality?.enabled === true
  const [savingAchievement, setSavingAchievement] = useState(false)
  const [achievementError, setAchievementError] = useState<string | null>(null)

  const toggleAchievement = async (checked: boolean) => {
    if (!story || readOnly) return
    setSavingAchievement(true)
    setAchievementError(null)
    try {
      await story.saveConfig({
        achievements: toggleEndingAchievement(achievements, { projectId: story.projectId, nodeId: id, title: titleOf(data) }, () => achievementId(crypto.randomUUID().slice(0, 8))),
      })
    } catch (cause) {
      setAchievementError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSavingAchievement(false)
    }
  }

  return (
    <StoryNodeShell id={id} type="story_ending" selected={selected} title={titleOf(data)}
      badge={<span className={`nori-story-node-kind is-ending-${ending.endingType}`}>{STORY_ENDING_LABEL[ending.endingType]}</span>}>
      <div className="nori-story-segmented nodrag" role="radiogroup" aria-label="结局类型">
        {STORY_ENDING_TYPES.map((type: StoryEndingType) => (
          <button key={type} type="button" role="radio" aria-checked={ending.endingType === type} className={ending.endingType === type ? 'is-active' : ''}
            disabled={readOnly} onClick={() => patch({ endingType: type }, '设置结局类型')}>
            {STORY_ENDING_LABEL[type].replace('结局', '')}
          </button>
        ))}
      </div>
      <textarea
        className="nodrag nowheel nori-story-textarea"
        rows={2}
        value={ending.description}
        placeholder="结局文案（可选）"
        readOnly={readOnly}
        onChange={(event) => patch({ description: event.target.value })}
      />
      <div className="nori-story-ending-flags">
        <label className="nori-story-check nodrag">
          <input type="checkbox" checked={Boolean(achievement)} disabled={readOnly || savingAchievement || !story} aria-label="设为成就"
            onChange={(event) => void toggleAchievement(event.target.checked)} />
          <span>设为成就</span>
        </label>
        <button type="button" className="nori-story-link-button nodrag" disabled={!story || readOnly}
          onClick={() => { requestStoryGameplaySegment('achievements'); story?.setPanel('gameplay') }}>
          在玩法设置中编辑
        </button>
      </div>
      <small className="nori-story-note">成就的名称和奖励在「玩法设置 → 成就」里编辑</small>
      {achievementError ? <p className="nori-story-note nori-ix-warning" role="alert">{achievementError}</p> : null}
      <div className="nori-story-ending-flags">
        <label className="nori-story-check nodrag">
          <input type="checkbox" checked={ending.showPersonality === true} disabled={readOnly || !personalityOn} aria-label="显示人格结果"
            onChange={(event) => patch({ showPersonality: event.target.checked }, '设置显示人格结果')} />
          <span>显示人格结果</span>
        </label>
      </div>
      {personalityOn ? null : <small className="nori-story-note">先在玩法设置里开启人格测试</small>}
    </StoryNodeShell>
  )
})
