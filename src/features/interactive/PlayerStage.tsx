'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { MediaImage } from '@/components/media/MediaImage'
import { AlertTriangle, ArrowRight, RotateCcw } from '@/components/ui/icons'
import { STORY_ENDING_LABEL } from '@/lib/interactive/compile'
import { beatTimeoutHandle, choiceTimeoutOption, resolveBeat, visibleOptions, type StoryRun, type StoryStop } from '@/lib/interactive/engine'
import { dueBeat, interactionTimeoutHandle } from '@/lib/interactive/interaction'
import { hasRandomResults, resolveRandomHandle } from '@/lib/interactive/interaction'
import { personalityView } from '@/lib/interactive/personality'
import type {
  StoryBeatDuring,
  StoryChoiceNode,
  StoryInteractionNode,
  StoryMedia,
  StoryProgram,
  StorySceneNode,
  StorySwipeDirection,
} from '@/lib/interactive/types'
import { toDisplayImageUrl, toPlayableVideoUrl } from '@/lib/media/image-url'
import { ChoicePanel } from './ChoicePanel'
import { InteractionCountdown } from './player/InteractionCountdown'
import { InteractionOverlay } from './player/InteractionOverlay'
import { applyBeatOutcome, createResolutionGate, type FiredBeats } from './player/beat-scheduler'
import type { DirectionMapping } from './player/interaction-sessions'
import { lockedOptionPress } from './player/locked-choice'
import { pictureState, seekToLastFrame, standaloneBackdrop } from './player/playback-plan'
import { playerNow } from './player/player-clock'
import type { StageTurn } from './player/stage-orientation'
import './player/records.css'

const display = (url: string | null | undefined) => (url ? toDisplayImageUrl(url) || url : null)
/** 视频 src 走 playback=1 代理（gzip + 缓存）；海报与图片仍走 display。 */
const playback = (url: string | null | undefined) => (url ? toPlayableVideoUrl(url) || url : null)

export type PlayerStageProps = {
  program: StoryProgram
  run: StoryRun
  backdrop: StoryMedia | null
  orientation: 'portrait' | 'landscape'
  /** Bumped when a standalone interaction retries, so its overlay re-arms. */
  attempt: number
  /** True while the shop sheet is open: the picture stays exactly where it was and timers stop. */
  paused?: boolean
  /** The viewer's chosen speed, applied only outside an interaction; limits stay in real seconds. */
  baseRate?: number
  /** Rotated screens: remaps the expected swipe direction. Identity when upright. */
  mapDirection?: DirectionMapping
  /** How far the whole stage is turned clockwise; only affects how a swipe drag is drawn. */
  turn?: StageTurn
  /** Opens the shop, optionally focused on the item a locked choice card links to. */
  onOpenShop?: (itemId: string | null) => void
  onRunChange: (run: StoryRun) => void
  onContinue: (run?: StoryRun) => void
  onChoose: (handle: string) => void
  onRestart: () => void
  onLocate?: (projectId: string, nodeId: string) => void
}

function StageMedia({ media, onEnded, onSkip, videoRef, paused = false, rate = 1, freezeLastFrame = false }: {
  media: StoryMedia | null
  onEnded?: () => void
  /** 「跳过这段」：场景调 onContinue，互动调超时 handle。 */
  onSkip?: () => void
  videoRef?: RefObject<HTMLVideoElement | null>
  paused?: boolean
  rate?: number
  /** Render the video paused on its last frame: used as the backdrop behind a choice panel
   *  so the previous segment does not replay while the viewer is deciding. */
  freezeLastFrame?: boolean
}) {
  const localRef = useRef<HTMLVideoElement | null>(null)
  const ref = videoRef ?? localRef
  const pausedByShop = useRef(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const rateRef = useRef(rate)
  rateRef.current = rate
  // Browsers reset playbackRate to defaultPlaybackRate whenever a new source loads, so both the
  // property and the element's own events re-apply the chosen speed.
  const applyRate = () => {
    const video = ref.current
    if (!video || media?.kind !== 'video') return
    if (video.defaultPlaybackRate !== rateRef.current) video.defaultPlaybackRate = rateRef.current
    if (video.playbackRate !== rateRef.current) video.playbackRate = rateRef.current
  }
  const seekToEnd = () => {
    if (!freezeLastFrame) return
    seekToLastFrame(ref.current)
  }
  useEffect(() => {
    setFailed(false)
    setLoading(false)
  }, [media?.url])
  useEffect(() => {
    applyRate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, rate, ref])
  useEffect(() => {
    const video = ref.current
    if (!video || media?.kind !== 'video') return
    if (freezeLastFrame) {
      seekToEnd()
      return
    }
    if (paused) {
      if (!video.paused) {
        video.pause()
        pausedByShop.current = true
      }
    } else if (pausedByShop.current) {
      pausedByShop.current = false
      if (!video.ended) void video.play().catch(() => {})
    }
  }, [media, paused, ref, freezeLastFrame])
  if (!media) {
    return (
      <div className="nori-player-media is-empty" data-testid="player-media-placeholder">
        <span className="nori-player-media-note">这一幕还没有画面</span>
      </div>
    )
  }
  if (failed) {
    return (
      <div className="nori-player-media is-empty" data-testid="player-media-failed">
        <div className="nori-player-media-failed">
          <span className="nori-player-media-note">画面加载失败</span>
          {onSkip ? <button type="button" className="nori-player-skip" onClick={onSkip}>跳过这段</button> : null}
        </div>
      </div>
    )
  }
  if (media.kind === 'video') {
    return (
      <>
        <video
          key={media.url}
          ref={ref}
          className="nori-player-media"
          data-testid="scene-video"
          src={playback(media.url) ?? undefined}
          poster={display(media.posterUrl) ?? undefined}
          autoPlay={!freezeLastFrame}
          preload="metadata"
          playsInline
          onLoadedMetadata={() => { applyRate(); seekToEnd() }}
          onLoadedData={() => { setLoading(false); seekToEnd() }}
          onWaiting={() => setLoading(true)}
          onError={() => setFailed(true)}
          onPlay={(e) => { if (freezeLastFrame) { e.currentTarget.pause(); return } applyRate() }}
          onEnded={onEnded}
        />
        {loading ? <span className="nori-player-loading" aria-hidden="true" /> : null}
      </>
    )
  }
  return <div className="nori-player-media"><MediaImage src={display(media.url) || ''} alt="" fill sizes="80vw" draggable={false} /></div>
}

/* ---------- 剧情片段 + 挂载互动 ---------- */

type ActiveBeat = { beat: StoryInteractionNode; seq: number; startedAt: number }

function SceneStage({
  program,
  run,
  stop,
  orientation,
  baseRate,
  mapDirection,
  turn,
  paused,
  onOpenShop,
  onRunChange,
  onContinue,
}: {
  program: StoryProgram
  run: StoryRun
  stop: Extract<StoryStop, { kind: 'scene' }>
  orientation: 'portrait' | 'landscape'
  baseRate: number
  mapDirection: DirectionMapping
  turn: StageTurn
  paused: boolean
  onOpenShop?: (itemId: string | null) => void
  onRunChange: (run: StoryRun) => void
  onContinue: (run?: StoryRun) => void
}) {
  const node: StorySceneNode = stop.node
  const videoMedia = node.media?.kind === 'video' ? node.media : null
  const beats = videoMedia ? node.beats : []
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const firedRef = useRef<FiredBeats>(new Set())
  const activeRef = useRef<ActiveBeat | null>(null)
  const gateRef = useRef<((handle: string) => boolean) | null>(null)
  const seqRef = useRef(0)
  const [active, setActive] = useState<ActiveBeat | null>(null)

  // The rAF loop and the resolution gate live outside the render cycle; they always read
  // the latest run/program through this box so a re-render never remounts the video.
  const latest = useRef({ program, run, beats, baseRate, mapDirection, paused, onOpenShop, onRunChange, onContinue })
  latest.current = { program, run, beats, baseRate, mapDirection, paused, onOpenShop, onRunChange, onContinue }
  const finishRef = useRef<(beat: StoryInteractionNode, handle: string, fromEnded: boolean) => void>(() => {})
  const beginRef = useRef<(beat: StoryInteractionNode) => void>(() => {})

  const applyRate = (video: HTMLVideoElement, rate: number) => {
    video.defaultPlaybackRate = rate
    video.playbackRate = rate
  }

  const restoreVideo = () => {
    const video = videoRef.current
    if (!video) return
    applyRate(video, latest.current.baseRate)
    if (latest.current.paused) {
      video.pause()
      return
    }
    if (!video.ended) void video.play().catch(() => {})
  }

  const finishBeat = (beat: StoryInteractionNode, handle: string, fromEnded: boolean) => {
    const state = latest.current
    const settled = hasRandomResults(beat.results) ? resolveRandomHandle(beat.spec, beat.results, Math.random()) : handle
    if (!settled) return
    const outcome = resolveBeat(state.program, state.run, beat.id, settled)
    const plan = applyBeatOutcome(outcome, beat, state.beats, firedRef.current)
    firedRef.current = plan.fired
    activeRef.current = null
    gateRef.current = null
    setActive(null)
    if (plan.kind === 'cut') {
      state.onRunChange(plan.run)
      return
    }
    if (plan.kind === 'retry') {
      state.onRunChange(plan.run)
      const video = videoRef.current
      if (video) {
        applyRate(video, state.baseRate)
        if (plan.seekSec !== null) {
          try {
            video.currentTime = plan.seekSec
          } catch {
            // Seeking before metadata arrives leaves the video where it was.
          }
        }
        if (state.paused) video.pause()
        else void video.play().catch(() => {})
      }
      return
    }
    // continue / defer: with the segment already over the run advances (following a
    // pending cut when the result chose 本段播完再切), otherwise the picture resumes.
    if (fromEnded) {
      state.onContinue(plan.run)
      return
    }
    state.onRunChange(plan.run)
    restoreVideo()
  }
  finishRef.current = finishBeat

  const beginBeat = (beat: StoryInteractionNode) => {
    const video = videoRef.current
    if (!video || activeRef.current) return
    const seq = seqRef.current + 1
    seqRef.current = seq
    activeRef.current = { beat, seq, startedAt: playerNow() }
    gateRef.current = createResolutionGate<string>((handle) => finishRef.current(beat, handle, false))
    setActive({ beat, seq, startedAt: playerNow() })
    const picture = pictureState(latest.current.baseRate, beat.during, latest.current.paused)
    applyRate(video, picture.rate)
    if (!picture.playing) video.pause()
  }
  beginRef.current = beginBeat

  useEffect(() => {
    const video = videoRef.current
    if (!video || beats.length === 0) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (activeRef.current || video.ended || latest.current.paused) return
      const due = dueBeat(latest.current.beats, firedRef.current, video.currentTime)
      if (due) beginRef.current(due)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // The stage is keyed by the identity of run.stop, so the beat list never changes here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beats])

  const resolveActive = (handle: string) => {
    gateRef.current?.(handle)
  }

  const picture = pictureState(baseRate, active?.beat.during ?? null, paused)

  const handleEnded = () => {
    const current = activeRef.current
    if (current) {
      // The picture ran out while the interaction was still up: resolve its time-out first.
      const timeoutHandle = beatTimeoutHandle(current.beat.spec, latest.current.run.vars, latest.current.program.variables)
      if (timeoutHandle) finishRef.current(current.beat, timeoutHandle, true)
      else latest.current.onContinue()
      return
    }
    // The video element can outlive its SceneStage while React swaps stops; an ended event
    // from the old element must not advance the run again.
    if (latest.current.run.stop.kind !== 'scene') return
    latest.current.onContinue()
  }

  return (
    <>
      {node.media ? <StageMedia media={node.media} onEnded={videoMedia ? handleEnded : undefined} onSkip={() => latest.current.onContinue()} videoRef={videoRef} paused={!picture.playing} rate={picture.rate} /> : <div className="nori-player-media is-empty" />}
      {active?.beat.spec.type === 'hotspot' && active.beat.spec.frameImageUrl && active.beat.during !== 'play' ? <div className="nori-player-media nori-hotspot-backdrop"><MediaImage src={display(active.beat.spec.frameImageUrl) || ''} alt="" fill sizes="80vw" draggable={false} /></div> : null}
      {!node.media ? <div className="nori-player-placeholder"><strong>{node.title}</strong><span>这段剧情还没有画面</span></div> : null}
      {node.lines ? <p className="nori-player-subtitle">{node.lines}</p> : null}
      {run.pending ? <div className="nori-int-pending" data-testid="pending-chip">待切换：{run.pending.label}</div> : null}
      {active ? (
        <InteractionOverlay
          key={`${active.beat.id}:${active.seq}`}
          node={active.beat}
          orientation={orientation}
          startedAt={active.startedAt}
          run={run}
          variables={program.variables}
          onOpenShop={onOpenShop}
          onResult={resolveActive}
          mapDirection={mapDirection}
          turn={turn}
          className="is-masked"
        />
      ) : (
        <button type="button" className="nori-player-continue" onClick={() => latest.current.onContinue()}>继续<ArrowRight /></button>
      )}
    </>
  )
}

/* ---------- 独立互动停靠点 ---------- */

function InteractionBackdrop({ media, freeze, during, baseRate, paused = false, onSkip }: {
  media: StoryMedia | null
  /** 上一段最后一帧回退：定格在末帧，绝不从头重播。自己的画面则为 false。 */
  freeze: boolean
  during: StoryBeatDuring
  baseRate: number
  paused?: boolean
  onSkip?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const pausedByShop = useRef(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  // A standalone interaction is one continuous window: real pace, fixed slow motion, or frozen.
  const picture = pictureState(baseRate, during, paused)
  const playing = !freeze && picture.playing
  const rateRef = useRef(picture.rate)
  rateRef.current = picture.rate
  const applyRate = () => {
    const video = videoRef.current
    if (!video) return
    if (video.defaultPlaybackRate !== rateRef.current) video.defaultPlaybackRate = rateRef.current
    if (video.playbackRate !== rateRef.current) video.playbackRate = rateRef.current
  }
  const freezeFrame = () => { if (freeze) seekToLastFrame(videoRef.current) }
  useEffect(() => {
    setFailed(false)
    setLoading(false)
  }, [media?.url])
  useEffect(() => {
    applyRate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picture.rate])
  useEffect(() => {
    const video = videoRef.current
    if (!video || media?.kind !== 'video') return
    if (freeze) {
      seekToLastFrame(video)
      return
    }
    if (!picture.playing) {
      if (!video.paused) {
        video.pause()
        pausedByShop.current = true
      }
    } else if (pausedByShop.current) {
      pausedByShop.current = false
      if (!video.ended) void video.play().catch(() => {})
    }
  }, [media, freeze, picture.playing])
  if (!media) {
    return (
      <div className="nori-player-media is-empty" data-testid="player-media-placeholder">
        <span className="nori-player-media-note">这一幕还没有画面</span>
      </div>
    )
  }
  if (failed) {
    return (
      <div className="nori-player-media is-empty" data-testid="player-media-failed">
        <div className="nori-player-media-failed">
          <span className="nori-player-media-note">画面加载失败</span>
          {onSkip ? <button type="button" className="nori-player-skip" onClick={onSkip}>跳过这段</button> : null}
        </div>
      </div>
    )
  }
  if (media.kind === 'image') {
    return <div className="nori-player-media"><MediaImage src={display(media.url) || ''} alt="" fill sizes="80vw" draggable={false} /></div>
  }
  return (
    <>
      <video
        key={media.url}
        ref={videoRef}
        className="nori-player-media"
        data-testid="interaction-backdrop"
        src={playback(media.url) ?? undefined}
        poster={display(media.posterUrl) ?? undefined}
        autoPlay={playing}
        preload="metadata"
        playsInline
        onLoadedMetadata={() => { applyRate(); freezeFrame() }}
        onLoadedData={() => { setLoading(false); freezeFrame() }}
        onWaiting={() => setLoading(true)}
        onError={() => setFailed(true)}
        onPlay={(e) => { if (freeze) { e.currentTarget.pause(); return } applyRate() }}
        onEnded={(e) => e.currentTarget.pause()}
      />
      {loading ? <span className="nori-player-loading" aria-hidden="true" /> : null}
    </>
  )
}

function StandaloneOverlay({ program, run, node, orientation, onChoose, onOpenShop, mapDirection, turn }: {
  program: StoryProgram
  run: StoryRun
  node: StoryInteractionNode
  orientation: 'portrait' | 'landscape'
  onChoose: (handle: string) => void
  onOpenShop?: (itemId: string | null) => void
  mapDirection: DirectionMapping
  turn: StageTurn
}) {
  const [startedAt] = useState(() => playerNow())
  return (
    <InteractionOverlay
      node={node}
      orientation={orientation}
      startedAt={startedAt}
      durationSec={node.durationSec}
      run={run}
      variables={program.variables}
      onOpenShop={onOpenShop}
      onResult={onChoose}
      mapDirection={mapDirection}
      turn={turn}
      className="is-masked"
    />
  )
}

/* ---------- 限时抉择停靠点 ---------- */

function ChoiceStage({ program, run, node, orientation, backdrop, baseRate, paused, onChoose, onOpenShop }: {
  program: StoryProgram
  run: StoryRun
  node: StoryChoiceNode
  orientation: 'portrait' | 'landscape'
  backdrop: StoryMedia | null
  baseRate: number
  paused: boolean
  onChoose: (handle: string) => void
  onOpenShop?: (itemId: string | null) => void
}) {
  const [startedAt] = useState(() => playerNow())
  const [lockedHint, setLockedHint] = useState(0)
  const timeoutSec = typeof node.timeoutSec === 'number' && node.timeoutSec > 0 ? node.timeoutSec : null
  // Options are re-evaluated from the live run: a purchase unlocks the card in place, and the
  // countdown keeps its startedAt because this stop never remounts.
  const views = visibleOptions(node.options, run.vars, program.variables)
  useEffect(() => {
    if (!lockedHint) return
    const timer = setTimeout(() => setLockedHint(0), 2200)
    return () => clearTimeout(timer)
  }, [lockedHint])
  const onTimeout = () => {
    const fallback = choiceTimeoutOption(node, run.vars, program.variables)
    if (fallback) onChoose(fallback)
  }
  const handleLocked = (optionId: string) => {
    const press = lockedOptionPress(node.options, optionId, run.vars, program.variables)
    if (press.kind === 'shop' && onOpenShop) onOpenShop(press.itemId)
    else if (press.kind !== 'none') setLockedHint((count) => count + 1)
  }
  return (
    <>
      {node.backdrop
        ? <StageMedia media={node.backdrop} paused={paused} rate={baseRate} />
        : <StageMedia media={backdrop} paused={paused} rate={baseRate} freezeLastFrame />}
      <div className={`nori-player-choice is-${orientation}`}>
        <ChoicePanel
          prompt={node.prompt || node.title}
          options={views.map((view) => ({ ...view.option, locked: view.locked }))}
          panelStyle={node.panelStyle}
          layout={node.layout}
          orientation={orientation}
          onChoose={onChoose}
          onLockedPress={handleLocked}
          header={(
            <>
              {timeoutSec ? <InteractionCountdown startedAt={startedAt} durationSec={timeoutSec} onTimeout={onTimeout} inline /> : null}
              {lockedHint ? <p className="nori-choice-lock-hint" role="status" data-testid="locked-hint">还没有解锁</p> : null}
            </>
          )}
        />
      </div>
    </>
  )
}

/* ---------- stage ---------- */

export function PlayerStage({
  program,
  run,
  backdrop,
  orientation,
  attempt,
  paused = false,
  baseRate = 1,
  mapDirection = (direction: StorySwipeDirection) => direction,
  turn = 0,
  onOpenShop,
  onRunChange,
  onContinue,
  onChoose,
  onRestart,
  onLocate,
}: PlayerStageProps) {
  const { stop } = run
  if (stop.kind === 'scene') {
    return (
      <SceneStage
        program={program}
        run={run}
        stop={stop}
        orientation={orientation}
        baseRate={baseRate}
        mapDirection={mapDirection}
        turn={turn}
        paused={paused}
        onOpenShop={onOpenShop}
        onRunChange={onRunChange}
        onContinue={onContinue}
      />
    )
  }
  if (stop.kind === 'choice') {
    return (
      <ChoiceStage
        program={program}
        run={run}
        node={stop.node}
        orientation={orientation}
        backdrop={backdrop}
        baseRate={baseRate}
        paused={paused}
        onChoose={onChoose}
        onOpenShop={onOpenShop}
      />
    )
  }
  if (stop.kind === 'interaction') {
    const node = stop.node
    const plan = standaloneBackdrop(node, backdrop)
    // 没接画面时，热区仍用背景帧当底图（热区坐标的基准）；一旦接了画面，画面优先（§A.2）。
    const frameUrl = node.spec.type === 'hotspot' && node.during !== 'play' ? node.spec.frameImageUrl : null
    const media = !node.picture && frameUrl ? { kind: 'image' as const, url: frameUrl, posterUrl: null } : plan.media
    const freeze = !node.picture && frameUrl ? false : plan.freeze
    const skip = () => { const handle = interactionTimeoutHandle(node.spec); if (handle) onChoose(handle) }
    return (
      <>
        <InteractionBackdrop media={media} freeze={freeze} during={node.during} baseRate={baseRate} paused={paused} onSkip={skip} />
        <StandaloneOverlay
          key={`${stop.node.id}:${attempt}`}
          program={program}
          run={run}
          node={stop.node}
          orientation={orientation}
          onChoose={onChoose}
          onOpenShop={onOpenShop}
          mapDirection={mapDirection}
          turn={turn}
        />
      </>
    )
  }
  if (stop.kind === 'ending') {
    const { node } = stop
    // The pure layer decides everything: the ending's checkbox must be on, the test enabled, and
    // at least one tagged choice made — otherwise there is no card at all.
    const personality = node.showPersonality ? personalityView(program.personality, run.personality) : null
    return (
      <>
        <StageMedia media={backdrop} paused={paused} rate={baseRate} />
        <div className={`nori-player-card is-ending is-${node.endingType}${personality ? ' has-personality' : ''}`}>
          <span>{STORY_ENDING_LABEL[node.endingType]}</span>
          <strong>{node.title}</strong>
          {node.description ? <p>{node.description}</p> : null}
          {personality ? (
            <div className="nori-personality" data-testid="personality-card" data-type={personality.type}>
              {personality.imageUrl ? <MediaImage src={display(personality.imageUrl) || ''} alt="" className="nori-personality-image" draggable={false} /> : null}
              <div className="nori-personality-info">
                <span className="nori-personality-type" data-testid="personality-type">{personality.type}</span>
                <strong data-testid="personality-name">{personality.name}</strong>
                <p data-testid="personality-description">{personality.description}</p>
              </div>
            </div>
          ) : null}
          <button type="button" onClick={onRestart}><RotateCcw />重新开始</button>
        </div>
      </>
    )
  }
  if (stop.kind === 'exit') {
    return (
      <>
        <StageMedia media={backdrop} paused={paused} rate={baseRate} />
        <div className="nori-player-card">
          <span>本章结束</span>
          <strong>到达出口「{stop.node.title}」</strong>
          <p>全剧试玩时会从这里进入下一章。</p>
          <button type="button" onClick={onRestart}><RotateCcw />重新开始</button>
        </div>
      </>
    )
  }
  return (
    <div className="nori-player-card is-halt">
      <AlertTriangle />
      <strong>试玩中断</strong>
      <p>{stop.message}</p>
      <div>
        {onLocate && stop.projectId && stop.nodeId ? <button type="button" onClick={() => onLocate(stop.projectId!, stop.nodeId!)}>定位到节点</button> : null}
        <button type="button" onClick={onRestart}><RotateCcw />重新开始</button>
      </div>
    </div>
  )
}
